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
// 限制: 单文件 <=50MB, 总数 <= 30, 总体积 <= 200MB (常规表单接口)
const MAX_FILES = 30;
const MAX_SINGLE = 50 * 1024 * 1024;
const MAX_TOTAL = 200 * 1024 * 1024;
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];
const upload = multer({ limits: { fileSize: MAX_SINGLE } });

// 分块上传配置（支持大文件绕过单请求限制）
const CHUNK_MAX_FILE = Number(process.env.CHUNK_MAX_FILE || 800 * 1024 * 1024); // 大文件上限 800MB
const CHUNK_MAX_SESSION_MEMORY = Number(process.env.CHUNK_MAX_SESSION_MEMORY || 800 * 1024 * 1024); // 所有会话缓存上限
const CHUNK_SESSION_TTL = Number(process.env.CHUNK_SESSION_TTL || 15 * 60 * 1000); // 15 分钟未活动回收
const CHUNK_SIZE_LIMIT = Number(process.env.CHUNK_SIZE_LIMIT || 16 * 1024 * 1024); // 单块最大 16MB (客户端可更小)

interface UploadSession {
    id: string;
    filename: string;
    mime: string;
    totalSize: number;
    totalChunks: number;
    receivedBytes: number;
    chunks: Map<number, Buffer>; // index->data
    created: number;
    updated: number;
    quality?: number;
    hash?: string; // 客户端可选传摘要，用于去重(未实现逻辑仅占位)
    clientId?: string; // 前端队列项 ID
}
const UPLOAD_SESSIONS = new Map<string, UploadSession>();
// hash+quality -> cacheId (压缩结果缓存索引，命中即可秒传)
const COMPRESSED_HASH_INDEX = new Map<string, string>();

function currentUploadBytes() {
    let sum = 0;
    for (const v of UPLOAD_SESSIONS.values()) sum += v.receivedBytes;
    return sum;
}

function cleanupUploadSessions() {
    const now = Date.now();
    for (const [k, v] of UPLOAD_SESSIONS) {
        if (now - v.updated > CHUNK_SESSION_TTL) {
            UPLOAD_SESSIONS.delete(k);
        }
    }
}
setInterval(cleanupUploadSessions, 60 * 1000).unref();

// 原同步压缩逻辑（保留用于非进度模式）
async function compressBuffer(id: string, originalName: string, mime: string, buffer: Buffer, quality: number, originalHash?: string): Promise<CompressItemResult> {
    try {
        if (!ALLOWED_MIME.includes(mime)) return { id, originalName, error: "unsupported_type" };
        const meta = await sharp(buffer).metadata();
        const totalPixels = (meta.width || 0) * (meta.height || 0);
        if (totalPixels > 80_000_000) return { id, originalName, error: "dimensions_too_large" };
        const MAX_PIXELS = Number(process.env.MAX_PIXELS || 35_000_000);
        let pipeline = sharp(buffer, { failOn: "warning" });
        let scaled = false;
        if (totalPixels > MAX_PIXELS && meta.width && meta.height) {
            const scale = Math.sqrt(MAX_PIXELS / totalPixels);
            const targetW = Math.max(1, Math.floor(meta.width * scale));
            const targetH = Math.max(1, Math.floor(meta.height * scale));
            pipeline = pipeline.resize({ width: targetW, height: targetH, fit: "inside" });
            scaled = true;
        }
        if (mime.includes("jpeg")) pipeline = pipeline.jpeg({ quality, mozjpeg: true });
        else if (mime.includes("png")) pipeline = pipeline.png({ quality, compressionLevel: 9, palette: true });
        else if (mime.includes("webp")) pipeline = pipeline.webp({ quality });
        const FILE_TIMEOUT_MS = Number(process.env.FILE_TIMEOUT_MS || 30000);
        const outBuffer = await Promise.race([pipeline.toBuffer(), new Promise<Buffer>((resolve) => setTimeout(() => resolve(Buffer.from([])), FILE_TIMEOUT_MS))]);
        if (!outBuffer.length) return { id, originalName, error: "timeout" };
        let finalBuffer = outBuffer;
        if (!scaled && outBuffer.length >= buffer.length) {
            finalBuffer = buffer; // 不增大
        }
        if (!evictIfNeeded(finalBuffer.length)) return { id, originalName, error: "cache_overflow" };
        RESULT_CACHE.set(id, { buffer: finalBuffer, mime, filename: originalName, size: finalBuffer.length, created: Date.now() });
        if (originalHash) {
            // 记录 hash+quality -> id
            COMPRESSED_HASH_INDEX.set(`${originalHash}:${quality}`, id);
        }
        return {
            id,
            originalName,
            mime,
            originalSize: buffer.length,
            compressedSize: finalBuffer.length,
            width: meta.width,
            height: meta.height,
            downloadUrl: `/api/download/${id}`
        };
    } catch (e: any) {
        return { id, originalName, error: e.message || "compress_failed" };
    }
}

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

// 基于步骤的可报告进度压缩
interface ProgressJob {
    id: string; // jobId (独立于客户端传的 queueId)
    clientId: string; // 前端项 id
    originalName: string;
    mime: string;
    buffer: Buffer;
    quality: number;
    created: number;
    phase: "queued" | "decoding" | "resizing" | "encoding" | "finalizing" | "done" | "error";
    progress: number; // 0-1
    resultId?: string; // cache id
    compressedSize?: number;
    downloadUrl?: string;
    error?: string;
}
const JOBS = new Map<string, ProgressJob>();

async function processJob(job: ProgressJob) {
    try {
        job.phase = "decoding";
        job.progress = 0.05;
        const meta = await sharp(job.buffer).metadata();
        const totalPixels = (meta.width || 0) * (meta.height || 0);
        if (totalPixels > 80_000_000) throw new Error("dimensions_too_large");
        const MAX_PIXELS = Number(process.env.MAX_PIXELS || 35_000_000);
        let workBuffer = job.buffer;
        let scaled = false;
        if (totalPixels > MAX_PIXELS && meta.width && meta.height) {
            job.phase = "resizing";
            job.progress = 0.15;
            const scale = Math.sqrt(MAX_PIXELS / totalPixels);
            const targetW = Math.max(1, Math.floor(meta.width * scale));
            const targetH = Math.max(1, Math.floor(meta.height * scale));
            workBuffer = await sharp(job.buffer, { failOn: "warning" }).resize({ width: targetW, height: targetH, fit: "inside" }).toBuffer();
            scaled = true;
            job.progress = 0.4;
        }
        job.phase = "encoding";
        job.progress = Math.max(job.progress, 0.45);
        let encoder = sharp(workBuffer, { failOn: "warning" });
        if (job.mime.includes("jpeg")) encoder = encoder.jpeg({ quality: job.quality, mozjpeg: true });
        else if (job.mime.includes("png")) encoder = encoder.png({ quality: job.quality, compressionLevel: 9, palette: true });
        else if (job.mime.includes("webp")) encoder = encoder.webp({ quality: job.quality });
        const FILE_TIMEOUT_MS = Number(process.env.FILE_TIMEOUT_MS || 30000);
        const encoded = await Promise.race([encoder.toBuffer(), new Promise<Buffer>((resolve) => setTimeout(() => resolve(Buffer.from([])), FILE_TIMEOUT_MS))]);
        if (!encoded.length) throw new Error("timeout");
        let finalBuffer = encoded;
        if (!scaled && encoded.length >= job.buffer.length) finalBuffer = job.buffer; // 不放大
        job.phase = "finalizing";
        job.progress = 0.95;
        if (!evictIfNeeded(finalBuffer.length)) throw new Error("cache_overflow");
        const resultId = job.clientId; // 使用客户端 id 作为缓存 key 以便重压缩覆盖
        RESULT_CACHE.set(resultId, { buffer: finalBuffer, mime: job.mime, filename: job.originalName, size: finalBuffer.length, created: Date.now() });
        job.phase = "done";
        job.progress = 1;
        job.resultId = resultId;
        job.compressedSize = finalBuffer.length;
        job.downloadUrl = `/api/download/${resultId}`;
    } catch (e: any) {
        job.phase = "error";
        job.error = e.message || "compress_failed";
        job.progress = 1;
    }
}

function scheduleJob(job: ProgressJob) {
    // 立即异步执行，不阻塞主请求
    setImmediate(() => processJob(job));
}

app.post("/api/compress", upload.array("files"), async (req, res, next) => {
    const qualityRaw = Number(req.query.quality);
    const quality = Number.isFinite(qualityRaw) ? Math.min(100, Math.max(1, qualityRaw)) : 70;
    const wantProgress = req.query.progress === "1"; // 是否启用异步进度模式
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

    const ID_SEP = "__IDSEP__"; // 与前端协同的 id 分隔符
    if (wantProgress) {
        // 创建异步 job 返回 jobId
        const jobsResp: any[] = [];
        for (const f of inputFiles) {
            let originalName = f.originalname;
            let embeddedId: string | undefined;
            const sepIndex = originalName.indexOf(ID_SEP);
            if (sepIndex > -1) {
                embeddedId = originalName.slice(0, sepIndex);
                originalName = originalName.slice(sepIndex + ID_SEP.length);
            }
            const clientId = embeddedId || clientMap[originalName] || crypto.randomUUID();
            const jobId = crypto.randomUUID();
            const job: ProgressJob = {
                id: jobId,
                clientId,
                originalName,
                mime: f.mimetype,
                buffer: f.buffer,
                quality,
                created: Date.now(),
                phase: "queued",
                progress: 0
            };
            JOBS.set(jobId, job);
            scheduleJob(job);
            jobsResp.push({ id: clientId, jobId, originalName });
        }
        return res.json({ async: true, quality, count: jobsResp.length, items: jobsResp });
    } else {
        const tasks: Promise<CompressItemResult>[] = inputFiles.map((f) =>
            limit(async () => {
                let originalName = f.originalname;
                let embeddedId: string | undefined;
                const sepIndex = originalName.indexOf(ID_SEP);
                if (sepIndex > -1) {
                    embeddedId = originalName.slice(0, sepIndex);
                    originalName = originalName.slice(sepIndex + ID_SEP.length);
                }
                const clientId = embeddedId || clientMap[originalName] || crypto.randomUUID();
                (f as any).originalname = originalName;
                return compressBuffer(clientId, originalName, f.mimetype, f.buffer, quality);
            })
        );
        try {
            const settled = await Promise.all(tasks);
            const success = settled.filter((i: any) => !("error" in i)).length;
            const failed = settled.length - success;
            const body: CompressResponse = { quality, count: settled.length, success, failed, items: settled };
            res.json(body);
        } catch (e: any) {
            return next(e);
        }
    }
});

// 轮询单个 job 状态
app.get("/api/job/:jobId", (req, res) => {
    const job = JOBS.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: "not_found" });
    res.json({
        jobId: job.id,
        id: job.clientId,
        phase: job.phase,
        progress: job.progress,
        error: job.error,
        downloadUrl: job.downloadUrl,
        compressedSize: job.compressedSize
    });
    // 成功或失败可选择清理缓存在一定时间后，这里保留 2 分钟
    if ((job.phase === "done" || job.phase === "error") && Date.now() - job.created > 2 * 60 * 1000) {
        JOBS.delete(job.id);
    }
});

// 批量查询进度 ?ids=jobId1,jobId2
app.get("/api/jobs", (req, res) => {
    const idsParam = (req.query.ids as string) || "";
    const ids = idsParam.split(",").filter(Boolean);
    const list = ids.map((id) => {
        const job = JOBS.get(id);
        if (!job) return { jobId: id, missing: true };
        return { jobId: id, id: job.clientId, phase: job.phase, progress: job.progress, error: job.error, downloadUrl: job.downloadUrl, compressedSize: job.compressedSize };
    });
    res.json({ items: list });
});

// 统一错误处理（包括 multer 限制）
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err && err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "file_too_large" });
    }
    if (err && err.code === "LIMIT_UNEXPECTED_FILE") {
        return res.status(400).json({ error: "unexpected_file_field" });
    }
    console.error("unhandled_error", err);
    res.status(500).json({ error: "internal_error" });
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

// --- 分块上传接口 ---
app.post("/api/upload/init", express.json(), (req, res) => {
    const { filename, size, mime, totalChunks, quality, hash, clientId } = req.body || {};
    if (!filename || !Number.isFinite(size) || !mime || !Number.isFinite(totalChunks)) {
        return res.status(400).json({ error: "bad_request" });
    }
    if (!ALLOWED_MIME.includes(mime)) return res.status(400).json({ error: "unsupported_type" });
    if (size > CHUNK_MAX_FILE) return res.status(400).json({ error: "file_too_large" });
    const q = Math.min(100, Math.max(1, Number(quality) || 70));
    // 秒传: 若提供 hash 且已有对应质量结果
    if (hash) {
        const key = `${hash}:${q}`;
        const cacheId = COMPRESSED_HASH_INDEX.get(key);
        if (cacheId) {
            const entry = RESULT_CACHE.get(cacheId);
            if (entry) {
                const instantItem: CompressItemResult = {
                    id: cacheId,
                    originalName: filename,
                    mime: entry.mime,
                    originalSize: entry.size,
                    compressedSize: entry.size,
                    width: undefined,
                    height: undefined,
                    downloadUrl: `/api/download/${cacheId}`
                } as any; // width/height 不存储，客户端可忽略
                return res.json({ instant: true, uploadId: crypto.randomUUID(), item: instantItem });
            } else {
                // 失效 - 移除索引
                COMPRESSED_HASH_INDEX.delete(key);
            }
        }
    }
    // 断点续传: 查找是否存在同 hash 未完成会话
    if (hash) {
        for (const s of UPLOAD_SESSIONS.values()) {
            if (s.hash === hash && s.filename === filename && s.totalSize === size && s.mime === mime) {
                return res.json({
                    uploadId: s.id,
                    resume: true,
                    receivedBytes: s.receivedBytes,
                    receivedIndices: Array.from(s.chunks.keys())
                });
            }
        }
    }
    // 内存占用限制
    if (currentUploadBytes() + size > CHUNK_MAX_SESSION_MEMORY) return res.status(429).json({ error: "server_busy" });
    const id = crypto.randomUUID();
    const now = Date.now();
    UPLOAD_SESSIONS.set(id, {
        id,
        filename,
        mime,
        totalSize: size,
        totalChunks,
        receivedBytes: 0,
        chunks: new Map(),
        created: now,
        updated: now,
        quality: q,
        hash,
        clientId: typeof clientId === "string" && clientId ? clientId : undefined
    });
    res.json({ uploadId: id, resume: false, receivedBytes: 0, receivedIndices: [] });
});

// 复用 multer 但限制单块大小
const chunkUpload = multer({ limits: { fileSize: CHUNK_SIZE_LIMIT } });
app.post("/api/upload/chunk", chunkUpload.single("chunk"), (req, res) => {
    const { uploadId, index } = req.query as Record<string, string>;
    if (!uploadId || index === undefined) return res.status(400).json({ error: "bad_request" });
    const session = UPLOAD_SESSIONS.get(uploadId);
    if (!session) return res.status(404).json({ error: "upload_not_found" });
    const idx = Number(index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= session.totalChunks) return res.status(400).json({ error: "bad_index" });
    // 已存在该 chunk -> 幂等处理
    if (session.chunks.has(idx)) {
        return res.json({ received: session.receivedBytes, total: session.totalSize, done: session.chunks.size === session.totalChunks, duplicate: true });
    }
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ error: "no_chunk" });
    // 累加
    session.chunks.set(idx, file.buffer);
    session.receivedBytes += file.size;
    session.updated = Date.now();
    if (session.receivedBytes > session.totalSize) {
        UPLOAD_SESSIONS.delete(uploadId);
        return res.status(400).json({ error: "upload_size_mismatch" });
    }
    res.json({ received: session.receivedBytes, total: session.totalSize, done: session.chunks.size === session.totalChunks });
});

app.post("/api/upload/complete", async (req, res) => {
    const { uploadId, quality, progress } = req.query as Record<string, string>;
    if (!uploadId) return res.status(400).json({ error: "bad_request" });
    const session = UPLOAD_SESSIONS.get(uploadId);
    if (!session) return res.status(404).json({ error: "upload_not_found" });
    if (session.chunks.size !== session.totalChunks || session.receivedBytes !== session.totalSize) {
        return res.status(400).json({ error: "incomplete_upload" });
    }
    // 组装
    const ordered: Buffer[] = [];
    for (let i = 0; i < session.totalChunks; i++) {
        const part = session.chunks.get(i);
        if (!part) return res.status(400).json({ error: "missing_chunk" });
        ordered.push(part);
    }
    const full = Buffer.concat(ordered);
    // 释放内存（尽快）
    UPLOAD_SESSIONS.delete(uploadId);
    const q = Math.min(100, Math.max(1, Number(quality) || session.quality || 70));
    if (progress === "1") {
        // 异步 job 路径
        const clientId = session.clientId || uploadId;
        const jobId = crypto.randomUUID();
        const job: ProgressJob = {
            id: jobId,
            clientId,
            originalName: session.filename,
            mime: session.mime,
            buffer: full,
            quality: q,
            created: Date.now(),
            phase: "queued",
            progress: 0
        };
        JOBS.set(jobId, job);
        scheduleJob(job);
        return res.json({ async: true, jobId, id: clientId, quality: q });
    } else {
        const clientId = session.clientId || uploadId;
        const result = await compressBuffer(clientId, session.filename, session.mime, full, q, session.hash);
        return res.json({ item: result, quality: q });
    }
});
