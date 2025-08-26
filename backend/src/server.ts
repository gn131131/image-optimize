import express from "express";
import cors from "cors";
import multer from "multer";
import sharp from "sharp";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
});

// /api/compress 批量压缩保持输入输出格式一致
const upload = multer({ limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB 单文件限制

app.post("/api/compress", upload.array("files"), async (req, res) => {
    try {
        const quality = Math.min(100, Math.max(1, Number(req.query.quality) || 70));
        const tasks = ((req.files as Express.Multer.File[]) || []).map(async (f) => {
            const mime = f.mimetype; // 保持原格式
            let pipeline = sharp(f.buffer, { failOn: "none" });
            const meta = await pipeline.metadata();
            // 根据原始格式调用对应输出
            if (mime.includes("jpeg") || mime.includes("jpg")) {
                pipeline = pipeline.jpeg({ quality, mozjpeg: true });
            } else if (mime.includes("png")) {
                pipeline = pipeline.png({ quality });
            } else if (mime.includes("webp")) {
                pipeline = pipeline.webp({ quality });
            } else {
                /* 其它格式原样输出 */
            }
            const outBuffer = await pipeline.toBuffer();
            return {
                originalName: f.originalname,
                mime,
                originalSize: f.size,
                compressedSize: outBuffer.length,
                width: meta.width,
                height: meta.height,
                data: outBuffer.toString("base64")
            };
        });
        const results = await Promise.all(tasks);
        res.json({ quality, count: results.length, items: results });
    } catch (e: any) {
        console.error("compress error", e);
        res.status(500).json({ error: e.message || "compress_failed" });
    }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
    console.log(`Backend server listening on :${port}`);
});
