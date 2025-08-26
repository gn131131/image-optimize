import express from "express";
import cors from "cors";
import multer from "multer";
import { optimizeImageBuffer } from "./services/optimizeService.js";
import archiver from "archiver";
import pino from "pino";
import rateLimit from "express-rate-limit";
import { Registry, collectDefaultMetrics, Histogram, Counter, Gauge } from "prom-client";
import crypto from "crypto";
import { LRUCache } from "./utils/lru.js";

const app = express();
app.disable("x-powered-by");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Rate limit
const limiter = rateLimit({ windowMs: 60_000, max: 120 });
app.use(limiter);

// Metrics
const registry = new Registry();
collectDefaultMetrics({ register: registry });
const hOptimize = new Histogram({ name: "optimize_duration_seconds", help: "Optimize duration seconds", registers: [registry] });
const cOptimizeErrors = new Counter({ name: "optimize_errors_total", help: "Optimize errors", registers: [registry] });
const gCacheItems = new Gauge({ name: "opt_cache_items", help: "Cache item count", registers: [registry] });

// Simple in-memory cache
interface CacheValue {
    format: string;
    data: Buffer;
    w?: number;
    h?: number;
    quality: number;
    ts: number;
}
const cache = new LRUCache<CacheValue>({ max: 600 });
function sha256(buf: Buffer) {
    return crypto.createHash("sha256").update(buf).digest("hex");
}
function cacheKey(hash: string, fmt: string, q: number, w?: number, h?: number) {
    return `${hash}:${fmt}:${q}:${w || ""}:${h || ""}`;
}
function setCache(key: string, val: CacheValue) {
    cache.set(key, val);
    gCacheItems.set(cache.size);
}
const logger = pino({ level: process.env.LOG_LEVEL || "info" });

app.use(cors());
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/metrics", async (_req, res) => {
    res.set("Content-Type", registry.contentType);
    res.end(await registry.metrics());
});

app.post("/api/optimize", upload.array("files", 20), async (req: express.Request, res: express.Response) => {
    try {
        const endTimer = hOptimize.startTimer();
        const quality = parseInt((req.body.quality as string) || "75", 10);
        const width = req.body.width ? parseInt(req.body.width, 10) : undefined;
        const height = req.body.height ? parseInt(req.body.height, 10) : undefined;
        const requestedFormat = (req.body.format as string) || "auto";
        const stripMeta = (req.body.stripMeta || "1") !== "0"; // stripMeta=false -> keep metadata
        const multi = req.body.multi === "1";
        const accept = (req.headers["accept"] || "") as string;
        const pixelLimit = 30_000_000; // 30 MP

        const files = (req.files as Express.Multer.File[]) || [];

        async function runLimited<T, R>(items: T[], limit: number, fn: (i: T) => Promise<R>): Promise<R[]> {
            const out: R[] = [];
            const active: Promise<void>[] = [];
            let idx = 0;
            async function run(item: T, i: number) {
                out[i] = await fn(item);
            }
            for (const it of items) {
                const i = idx++;
                const p = run(it, i).then(() => {
                    active.splice(active.indexOf(p), 1);
                });
                active.push(p);
                if (active.length >= limit) await Promise.race(active);
            }
            await Promise.all(active);
            return out;
        }

        async function processFile(file: Express.Multer.File) {
            const { buffer, originalname, mimetype, size } = file;
            const hash = sha256(buffer);
            // dimension probe for pixel guard
            try {
                const sharpLib = (await import("sharp")).default;
                const meta = await sharpLib(buffer).metadata();
                if (meta.width && meta.height && meta.width * meta.height > pixelLimit) {
                    throw new Error(`Image too large: ${meta.width}x${meta.height}`);
                }
            } catch (probeErr) {
                if (probeErr instanceof Error) throw probeErr;
            }
            const targetFormats: string[] = [];
            if (multi) {
                targetFormats.push("webp", "avif");
                targetFormats.push(mimetype === "image/png" ? "png" : "jpeg");
            } else if (requestedFormat === "auto") {
                if (/image\/avif/.test(accept)) targetFormats.push("avif");
                else if (/image\/webp/.test(accept)) targetFormats.push("webp");
                else targetFormats.push(mimetype === "image/png" ? "png" : "jpeg");
            } else {
                targetFormats.push(requestedFormat);
            }
            const uniqueFormats = [...new Set(targetFormats)];
            const variants: { format: string; data: Buffer }[] = [];
            for (const fmt of uniqueFormats) {
                const key = cacheKey(hash, fmt, quality, width, height);
                const cached = cache.get(key);
                if (cached) {
                    variants.push({ format: cached.format, data: cached.data });
                    continue;
                }
                let optimized = await optimizeImageBuffer(buffer, { quality, width, height, format: fmt, mimetype });
                if (!stripMeta) {
                    const sharpLib = (await import("sharp")).default;
                    const withMeta = sharpLib(optimized.data).withMetadata();
                    const preserved = await withMeta.toBuffer();
                    optimized.data = preserved;
                }
                setCache(key, { format: optimized.format, data: optimized.data, quality, w: width, h: height, ts: Date.now() });
                variants.push({ format: optimized.format, data: optimized.data });
            }
            variants.sort((a, b) => a.data.length - b.data.length);
            const best = variants[0];
            return {
                originalName: originalname,
                originalSize: size,
                optimizedSize: best.data.length,
                savedBytes: size - best.data.length,
                ratio: +(100 - (best.data.length / size) * 100).toFixed(2),
                buffer: best.data,
                downloadName: `optimized-${Date.now()}.${best.format}`,
                format: best.format,
                variants: variants.map((v) => ({ format: v.format, size: v.data.length, base64: `data:image/${v.format};base64,${v.data.toString("base64")}` }))
            };
        }

        const results = await runLimited(files, 4, processFile);

        // zip? for now single or multiple return as array of base64
        const totalOriginal = results.reduce((s, r) => s + r.originalSize, 0);
        const totalOptimized = results.reduce((s, r) => s + r.optimizedSize, 0);
        res.json({
            summary: {
                totalOriginal,
                totalOptimized,
                savedBytes: totalOriginal - totalOptimized,
                ratio: +(100 - (totalOptimized / Math.max(1, totalOriginal)) * 100).toFixed(2)
            },
            images: results.map((r) => ({
                originalName: r.originalName,
                originalSize: r.originalSize,
                optimizedSize: r.optimizedSize,
                savedBytes: r.savedBytes,
                ratio: r.ratio,
                format: r.format,
                downloadName: r.downloadName,
                base64: `data:image/${r.format};base64,${r.buffer.toString("base64")}`,
                variants: r.variants
            }))
        });
        endTimer();
    } catch (e: unknown) {
        const err = e as Error;
        logger.error({ err }, "optimize failed");
        cOptimizeErrors.inc();
        if (!res.headersSent) res.status(400).json({ error: err.message || "optimization failed" });
    }
});

app.post("/api/optimize/zip", upload.array("files", 20), async (req: express.Request, res: express.Response) => {
    try {
        const quality = parseInt((req.body.quality as string) || "75", 10);
        const format = (req.body.format as string) || "auto";
        const files = (req.files as Express.Multer.File[]) || [];
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", "attachment; filename=optimized.zip");
        const archive = archiver("zip", { zlib: { level: 9 } });
        archive.on("error", (err: Error) => {
            throw err;
        });
        archive.pipe(res);
        for (const file of files) {
            const optimized = await optimizeImageBuffer(file.buffer, { quality, width: undefined, height: undefined, format, mimetype: file.mimetype });
            archive.append(optimized.data, { name: optimized.filename });
        }
        archive.finalize();
    } catch (e: unknown) {
        const err = e as Error;
        logger.error({ err }, "zip optimize failed");
        if (!res.headersSent) res.status(500).json({ error: err.message || "zip failed" });
    }
});

const port = process.env.PORT || 4000;
app.listen(port, () => logger.info(`Image optimize backend running on :${port}`));

// Fallback error middleware
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, "unhandled");
    if (res.headersSent) return;
    res.status(500).json({ error: "internal_error" });
});
