import sharp, { Sharp } from "sharp";

interface OptimizeOptions {
    quality: number;
    width?: number;
    height?: number;
    format: string; // auto | webp | avif | jpeg | png
    mimetype: string;
}

// const LOSSY_SET = new Set(["image/jpeg", "image/webp", "image/avif"]); // reserved for future heuristics

export async function optimizeImageBuffer(buf: Buffer, opts: OptimizeOptions): Promise<{ data: Buffer; filename: string; format: string }> {
    let pipeline: Sharp = sharp(buf, { failOn: "none" });
    if (opts.width || opts.height) {
        pipeline = pipeline.resize({ width: opts.width, height: opts.height, fit: "inside", withoutEnlargement: true });
    }

    const targetFormat = await resolveFormat(opts.format, opts.mimetype, buf, opts.quality);

    switch (targetFormat) {
        case "webp":
            pipeline = pipeline.webp({ quality: opts.quality });
            break;
        case "avif":
            pipeline = pipeline.avif({ quality: Math.min(100, opts.quality + 10) });
            break;
        case "png":
            pipeline = pipeline.png({ quality: Math.min(100, opts.quality), compressionLevel: 9 });
            break;
        case "jpeg":
        case "jpg":
            pipeline = pipeline.jpeg({ quality: opts.quality, mozjpeg: true });
            break;
        default:
            // keep original -> choose between jpeg/webp if beneficial? For MVP just toBuffer
            break;
    }

    const data = await pipeline.toBuffer();
    const filename = `optimized-${Date.now()}.${targetFormat}`;
    return { data, filename, format: targetFormat };
}

export async function estimateBestFormat(buf: Buffer, mimetype: string, quality: number): Promise<string> {
    // Fast heuristic: if already modern (webp/avif) keep; if png and has many colors -> try webp, else png
    if (mimetype === "image/avif") return "avif";
    if (mimetype === "image/webp") return "webp";
    if (mimetype === "image/jpeg") return "webp"; // often smaller
    if (mimetype === "image/png") {
        // Rough probe: encode a tiny webp preview to compare
        try {
            const webpSize = (await sharp(buf).webp({ quality }).toBuffer()).length;
            if (webpSize < buf.length * 0.9) return "webp"; // >10% savings
    } catch { /* ignore probe errors */ }
        return "png";
    }
    return "webp";
}

export async function resolveFormat(requested: string, mimetype: string, buf: Buffer, quality: number): Promise<string> {
    if (requested && requested !== "auto") return normalizeFormat(requested);
    return estimateBestFormat(buf, mimetype, quality);
}

function normalizeFormat(f: string): string {
    return f.replace("jpg", "jpeg");
}
