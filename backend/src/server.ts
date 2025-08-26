import express from "express";
import cors from "cors";
import multer from "multer";
import sharp from "sharp";
import type { CompressResponse, CompressItemResult } from "./types/dto";
import crypto from "crypto";

// 简易并发控制器 (替代外部依赖 p-limit 以减少额外体积)
function createLimiter(max: number) {
    let active = 0;
    const queue: (() => void)[] = [];
    const next = () => {
        if (active >= max) return;
        const fn = queue.shift();
        if (!fn) return;
        active++;
        fn();
    };
    return function limit<T>(task: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            const run = () => {
                task()
                    .then((v) => resolve(v))
                    .catch(reject)
                    .finally(() => {
                        active--;
                        next();
                    });
            };
            queue.push(run);
            next();
        });
    };
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
});

// /api/compress 批量压缩保持输入输出格式一致
// 限制: 单文件 <=50MB, 总数 <= 30, 总体积 <= 200MB
const MAX_FILES = 30;
const MAX_SINGLE = 50 * 1024 * 1024;
const MAX_TOTAL = 200 * 1024 * 1024;
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];
const upload = multer({ limits: { fileSize: MAX_SINGLE } });

// 内存缓存: 简易存储压缩结果 (生产可换 Redis / 对象存储)
interface CacheEntry {
    buffer: Buffer;
    mime: string;
    filename: string;
    size: number;
    created: number;
}
const RESULT_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 分钟
const MAX_CACHE_BYTES = Number(process.env.MAX_CACHE_BYTES || 300 * 1024 * 1024); // 300MB 默认
const MAX_CACHE_ITEMS = Number(process.env.MAX_CACHE_ITEMS || 500); // 最大条目数

function currentCacheBytes() {
    let sum = 0;
    for (const v of RESULT_CACHE.values()) sum += v.size;
    return sum;
}

function evictIfNeeded(extraBytes: number) {
    if (extraBytes > MAX_CACHE_BYTES) return false; // 单个结果过大，直接失败
    let bytes = currentCacheBytes();
    if (bytes + extraBytes <= MAX_CACHE_BYTES && RESULT_CACHE.size < MAX_CACHE_ITEMS) return true;
    const now = Date.now();
    // 先基于 TTL 清除过期
    for (const [k, v] of RESULT_CACHE) {
        if (now - v.created > CACHE_TTL_MS) {
            RESULT_CACHE.delete(k);
        }
    }
    bytes = currentCacheBytes();
    while ((bytes + extraBytes > MAX_CACHE_BYTES || RESULT_CACHE.size >= MAX_CACHE_ITEMS) && RESULT_CACHE.size) {
        // Map 迭代顺序即插入顺序 -> 移除最旧
        const firstKey = RESULT_CACHE.keys().next().value as string | undefined;
        if (!firstKey) break;
        const removed = RESULT_CACHE.get(firstKey);
        RESULT_CACHE.delete(firstKey);
        if (removed) bytes -= removed.size;
    }
    return bytes + extraBytes <= MAX_CACHE_BYTES;
}

setInterval(() => {
    const now = Date.now();
    for (const [k, v] of RESULT_CACHE) {
        if (now - v.created > CACHE_TTL_MS) RESULT_CACHE.delete(k);
    }
}, 60 * 1000).unref();

app.post("/api/compress", upload.array("files"), async (req, res) => {
    const qualityRaw = Number(req.query.quality);
    const quality = Number.isFinite(qualityRaw) ? Math.min(100, Math.max(1, qualityRaw)) : 70;
    const inputFiles = (req.files as Express.Multer.File[]) || [];
    // 解析前端提供的 originalName -> clientId 映射（避免同名随机 ID 不匹配）
    let clientMap: Record<string, string> = {};
    if (req.body && typeof req.body.clientMap === "string") {
        try {
            clientMap = JSON.parse(req.body.clientMap);
        } catch {
            // ignore invalid json
        }
    }
    // 限制检查
    if (inputFiles.length > MAX_FILES) {
        return res.status(400).json({ error: `too_many_files(max ${MAX_FILES})` });
    }
    const totalSize = inputFiles.reduce((a, b) => a + b.size, 0);
    if (totalSize > MAX_TOTAL) {
        return res.status(400).json({ error: `total_size_exceeded(max ${Math.round(MAX_TOTAL / 1024 / 1024)}MB)` });
    }
    // 并发限制
    const limit = createLimiter(4); // 可调 4~8
    const FILE_TIMEOUT_MS = Number(process.env.FILE_TIMEOUT_MS || 30000); // 单文件处理超时 30s
    const MAX_PIXELS = Number(process.env.MAX_PIXELS || 35_000_000); // 超过则尝试等比缩放（约 35MP）

    function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T | Promise<T>): Promise<T> {
        return new Promise((resolve) => {
            let settled = false;
            const timer = setTimeout(async () => {
                if (settled) return;
                settled = true;
                resolve(await onTimeout());
            }, ms);
            p.then((v) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(v);
            }).catch((e) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(onTimeout());
            });
        });
    }

    const ID_SEP = "__IDSEP__"; // 与前端协同的 id 分隔符
    const tasks: Promise<CompressItemResult>[] = inputFiles.map((f) =>
        limit(async () => {
            // 尝试从 multipart filename 中拆出 queueId
            let originalName = f.originalname;
            let embeddedId: string | undefined;
            const sepIndex = originalName.indexOf(ID_SEP);
            if (sepIndex > -1) {
                embeddedId = originalName.slice(0, sepIndex);
                originalName = originalName.slice(sepIndex + ID_SEP.length);
            }
            const clientId = embeddedId || clientMap[originalName] || crypto.randomUUID(); // 使用嵌入 id -> map -> 随机
            // 统一再写回 f.originalname 供后续逻辑使用真实文件名
            (f as any).originalname = originalName;
            try {
                if (!ALLOWED_MIME.includes(f.mimetype)) {
                    return { id: clientId, originalName, error: "unsupported_type" };
                }
                const meta = await sharp(f.buffer).metadata();
                const totalPixels = (meta.width || 0) * (meta.height || 0);
                if (totalPixels > 80_000_000) {
                    return { id: clientId, originalName, error: "dimensions_too_large" };
                }
                let pipeline = sharp(f.buffer, { failOn: "warning" });
                let scaled = false;
                // 超大像素进行等比缩放，使总像素不超过 MAX_PIXELS
                if (totalPixels > MAX_PIXELS && meta.width && meta.height) {
                    const scale = Math.sqrt(MAX_PIXELS / totalPixels);
                    const targetW = Math.max(1, Math.floor(meta.width * scale));
                    const targetH = Math.max(1, Math.floor(meta.height * scale));
                    pipeline = pipeline.resize({ width: targetW, height: targetH, fit: "inside" });
                    scaled = true;
                }
                if (f.mimetype.includes("jpeg")) {
                    pipeline = pipeline.jpeg({ quality, mozjpeg: true });
                } else if (f.mimetype.includes("png")) {
                    pipeline = pipeline.png({ quality, compressionLevel: 9, palette: true });
                } else if (f.mimetype.includes("webp")) {
                    pipeline = pipeline.webp({ quality });
                }
                const outBuffer = await withTimeout(pipeline.toBuffer(), FILE_TIMEOUT_MS, () => Promise.resolve(Buffer.from([])));
                if (!outBuffer.length) {
                    return { id: clientId, originalName, error: "timeout" };
                }
                // 如果未缩放且压缩后反而变大/不变，则保留原文件，避免用户看到“变大”情况
                let finalBuffer = outBuffer;
                if (!scaled && outBuffer.length >= f.size) {
                    finalBuffer = f.buffer; // 回退到原始
                }
                if (!evictIfNeeded(finalBuffer.length)) {
                    return { id: clientId, originalName, error: "cache_overflow" };
                }
                RESULT_CACHE.set(clientId, { buffer: finalBuffer, mime: f.mimetype, filename: originalName, size: finalBuffer.length, created: Date.now() });
                return {
                    id: clientId,
                    originalName,
                    mime: f.mimetype,
                    originalSize: f.size,
                    compressedSize: finalBuffer.length,
                    width: meta.width,
                    height: meta.height,
                    downloadUrl: `/api/download/${clientId}`
                };
            } catch (err: any) {
                return { id: clientId, originalName, error: err.message || "compress_failed" };
            }
        })
    );
    try {
        const settled = await Promise.all(tasks);
        const success = settled.filter((i: any) => !("error" in i)).length;
        const failed = settled.length - success;
        const body: CompressResponse = {
            quality,
            count: settled.length,
            success,
            failed,
            items: settled
        };
        res.json(body);
    } catch (e: any) {
        console.error("compress route fatal", e);
        res.status(500).json({ error: e.message || "internal_error" });
    }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
    console.log(`Backend server listening on :${port}`);
});

// 下载端点 (临时缓存)
app.get("/api/download/:id", (req, res) => {
    const id = req.params.id;
    const entry = RESULT_CACHE.get(id);
    if (!entry) return res.status(404).send("not_found");
    res.setHeader("Content-Type", entry.mime);
    res.setHeader("Content-Length", entry.size.toString());
    // 由于同一个 queueId 可能多次重压缩（质量改变覆写缓存），禁用浏览器缓存避免获取旧版本
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.send(entry.buffer);
});
