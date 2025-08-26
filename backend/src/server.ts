import express from "express";
import cors from "cors";
import multer from "multer";
import sharp from "sharp";
import type { CompressResponse, CompressItemResult } from "./types/dto";

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
const upload = multer({
    limits: { fileSize: MAX_SINGLE }
});

app.post("/api/compress", upload.array("files"), async (req, res) => {
    const qualityRaw = Number(req.query.quality);
    const quality = Number.isFinite(qualityRaw) ? Math.min(100, Math.max(1, qualityRaw)) : 70;
    const inputFiles = (req.files as Express.Multer.File[]) || [];
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
    const tasks: Promise<CompressItemResult>[] = inputFiles.map((f) =>
        limit(async () => {
            const base: Partial<CompressItemResult> = { originalName: f.originalname } as any;
            const clientId = (req.body && (req.body[`${f.originalname}.id`] as string)) || ""; // 可选: 将前端附加 id 回显
            try {
                if (!ALLOWED_MIME.includes(f.mimetype)) {
                    return { originalName: f.originalname, error: "unsupported_type", id: clientId };
                }
                // 像素防护: 先探测 metadata
                const meta = await sharp(f.buffer).metadata();
                if ((meta.width || 0) * (meta.height || 0) > 80_000_000) {
                    return { originalName: f.originalname, error: "dimensions_too_large", id: clientId };
                }
                let pipeline = sharp(f.buffer);
                if (f.mimetype.includes("jpeg")) {
                    pipeline = pipeline.jpeg({ quality, mozjpeg: true });
                } else if (f.mimetype.includes("png")) {
                    pipeline = pipeline.png({ quality, compressionLevel: 9, palette: true });
                } else if (f.mimetype.includes("webp")) {
                    pipeline = pipeline.webp({ quality });
                }
                const outBuffer = await pipeline.toBuffer();
                return {
                    originalName: f.originalname,
                    mime: f.mimetype,
                    originalSize: f.size,
                    compressedSize: outBuffer.length,
                    width: meta.width,
                    height: meta.height,
                    data: outBuffer.toString("base64"),
                    id: clientId
                };
            } catch (err: any) {
                return { originalName: f.originalname, error: err.message || "compress_failed", id: clientId };
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
