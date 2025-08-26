import express from "express";
import cors from "cors";
import multer from "multer";
import { optimizeImageBuffer } from "./services/optimizeService.js";
import archiver from "archiver";
import pino from "pino";
import rateLimit from "express-rate-limit";
import { Registry, collectDefaultMetrics, Histogram, Counter, Gauge } from "prom-client";
import crypto from "crypto";
import compression from "compression";
import { createCache } from "./utils/cache.js";

const app = express();
app.disable("x-powered-by");

// Environment configurable limits
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || String(25 * 1024 * 1024), 10); // bytes
const RATE_WINDOW_MS = parseInt(process.env.RATE_WINDOW_MS || "60000", 10);
const RATE_MAX = parseInt(process.env.RATE_MAX || "120", 10);
const MAX_CONCURRENCY = parseInt(process.env.MAX_CONCURRENCY || "4", 10);
const PIXEL_LIMIT = parseInt(process.env.PIXEL_LIMIT || "30000000", 10); // 30MP default

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE } });

// Rate limit
const limiter = rateLimit({
    windowMs: RATE_WINDOW_MS,
    max: RATE_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: "rate_limited" })
});
app.use(limiter);

// Metrics
const registry = new Registry();
collectDefaultMetrics({ register: registry });
const hOptimize = new Histogram({ name: "optimize_duration_seconds", help: "Optimize duration seconds", registers: [registry] });
const cOptimizeErrors = new Counter({ name: "optimize_errors_total", help: "Optimize errors", labelNames: ["type"], registers: [registry] });
const gCacheItems = new Gauge({ name: "opt_cache_items", help: "Cache item count", registers: [registry] });
const cCacheHit = new Counter({ name: "opt_cache_hit_total", help: "Cache hit count", registers: [registry] });
const cCacheMiss = new Counter({ name: "opt_cache_miss_total", help: "Cache miss count", registers: [registry] });

// Cache (LRU or Redis)
interface CacheValue { format: string; data: Buffer; w?: number; h?: number; quality: number; ts: number }
const { cache, kind: cacheKind } = createCache();

function sha256(buf: Buffer) {
    return crypto.createHash("sha256").update(buf).digest("hex");
}
function cacheKey(hash: string, fmt: string, q: number, w?: number, h?: number) {
    return `${hash}:${fmt}:${q}:${w || ""}:${h || ""}`;
}
async function setCache(key: string, val: CacheValue) {
    await (cache as any).set(key, val);
    if (typeof (cache as any).size === "function") {
        const sz = (cache as any).size();
        if (typeof sz === "number") gCacheItems.set(sz);
    }
}
const logger = pino({ level: process.env.LOG_LEVEL || "info" });
logger.info({ cache: cacheKind }, "cache initialized");

// Middleware: compression & security headers
app.use(compression());
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self';"
    );
    next();
});

app.use(cors());
// Request logging
app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on("finish", () => {
        const ms = Number(process.hrtime.bigint() - start) / 1_000_000;
        logger.info({ m: req.method, u: req.originalUrl, s: res.statusCode, ms: +ms.toFixed(1) }, "req");
    });
    next();
});

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
        const pixelLimit = PIXEL_LIMIT;
        const files = (req.files as Express.Multer.File[]) || [];

        const runLimited = async <T, R>(items: T[], limit: number, fn: (i: T) => Promise<R>): Promise<R[]> => {
            const out: R[] = [];
            const active: Promise<void>[] = [];
            let idx = 0;
            const run = async (item: T, i: number) => { out[i] = await fn(item); };
            for (const it of items) {
                const i = idx++;
                const p = run(it, i).then(() => { active.splice(active.indexOf(p), 1); });
                active.push(p);
                if (active.length >= limit) await Promise.race(active);
            }
            await Promise.all(active);
            return out;
        };

    const processFile = async (file: Express.Multer.File) => {
            const { buffer, originalname, mimetype, size } = file;
            const hash = sha256(buffer);
            try {
                const sharpLib = (await import("sharp")).default;
                const meta = await sharpLib(buffer).metadata();
                if (meta.width && meta.height && meta.width * meta.height > pixelLimit) {
                    const err: any = new Error(`Image too large: ${meta.width}x${meta.height}`);
                    err.code = "pixel_limit";
                    throw err;
                }
            } catch (probeErr) { if (probeErr instanceof Error) throw probeErr; }
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
                const cached = await (cache as any).get(key);
                if (cached) { cCacheHit.inc(); variants.push({ format: cached.format, data: cached.data }); continue; }
                cCacheMiss.inc();
                const optimized = await optimizeImageBuffer(buffer, { quality, width, height, format: fmt, mimetype });
                if (!stripMeta) {
                    const sharpLib = (await import("sharp")).default;
                    optimized.data = await sharpLib(optimized.data).withMetadata().toBuffer();
                }
                await setCache(key, { format: optimized.format, data: optimized.data, quality, w: width, h: height, ts: Date.now() });
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
                variants: variants.map(v => ({ format: v.format, size: v.data.length, base64: `data:image/${v.format};base64,${v.data.toString("base64")}` }))
            };
    };

        const results = await runLimited(files, MAX_CONCURRENCY, processFile);
        const totalOriginal = results.reduce((s, r) => s + r.originalSize, 0);
        const totalOptimized = results.reduce((s, r) => s + r.optimizedSize, 0);
        res.setHeader("Cache-Control", "no-store");
        res.json({
            summary: { totalOriginal, totalOptimized, savedBytes: totalOriginal - totalOptimized, ratio: +(100 - (totalOptimized / Math.max(1, totalOriginal)) * 100).toFixed(2) },
            images: results.map(r => ({
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
        const err = e as any;
        const type = err.code || (err.message?.includes("too large") ? "pixel_limit" : "generic");
        logger.error({ err, type }, "optimize failed");
        cOptimizeErrors.inc({ type });
        if (!res.headersSent) res.status(400).json({ error: err.message || "optimization failed", type });
    }
});

app.post("/api/optimize/zip", upload.array("files", 20), async (req: express.Request, res: express.Response) => {
    try {
        const quality = parseInt((req.body.quality as string) || "75", 10);
        const format = (req.body.format as string) || "auto";
        const multi = req.body.multi === "1";
        const stripMeta = (req.body.stripMeta || "1") !== "0";
        const files = (req.files as Express.Multer.File[]) || [];
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", "attachment; filename=optimized.zip");
        const archive = archiver("zip", { zlib: { level: 9 } });
        archive.on("error", (err: Error) => { throw err; });
        archive.pipe(res);
        for (const file of files) {
            if (multi) {
                const base = file.originalname.replace(/\.[^.]+$/, "");
                const fmts = ["webp", "avif", file.mimetype === "image/png" ? "png" : "jpeg"];
                for (const f of [...new Set(fmts)]) {
                    const opt = await optimizeImageBuffer(file.buffer, { quality, width: undefined, height: undefined, format: f, mimetype: file.mimetype });
                    if (!stripMeta) {
                        const sharpLib = (await import("sharp")).default;
                        opt.data = await sharpLib(opt.data).withMetadata().toBuffer();
                    }
                    archive.append(opt.data, { name: `${base}.${opt.format}` });
                }
            } else {
                const optimized = await optimizeImageBuffer(file.buffer, { quality, width: undefined, height: undefined, format, mimetype: file.mimetype });
                archive.append(optimized.data, { name: optimized.filename });
            }
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
app.use((err: any, _req: express.Request, res: express.Response) => {
    logger.error({ err }, "unhandled");
    if (res.headersSent) return;
    res.status(500).json({ error: "internal_error" });
});
