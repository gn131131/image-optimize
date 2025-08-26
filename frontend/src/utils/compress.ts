import { QueueItem } from "../types";

export interface CompressOptions {
    quality: number; // 1-100
    outputFormat?: "jpeg" | "webp" | "png";
    maxWidth?: number;
    maxHeight?: number;
}

const createCanvas = (w: number, h: number) => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    return canvas;
};

export async function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(file);
    });
}

export async function compressFile(file: File, opts: CompressOptions): Promise<{ blob: Blob; dataUrl: string }> {
    const dataUrl = await readFileAsDataUrl(file);
    const img = await createImageBitmap(file);
    let { width, height } = img;
    if (opts.maxWidth && width > opts.maxWidth) {
        const ratio = opts.maxWidth / width;
        width = opts.maxWidth;
        height = Math.round(height * ratio);
    }
    if (opts.maxHeight && height > opts.maxHeight) {
        const ratio = opts.maxHeight / height;
        height = opts.maxHeight;
        width = Math.round(width * ratio);
    }
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D not supported");
    ctx.drawImage(img, 0, 0, width, height);
    const quality = Math.min(1, Math.max(0.01, opts.quality / 100));
    const format = opts.outputFormat || "jpeg";
    const mime = format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
    const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), mime, format === "png" ? undefined : quality));
    const compUrl = URL.createObjectURL(blob);
    const compDataUrl = await blobToDataURL(blob);
    return { blob, dataUrl: compDataUrl };
}

export function blobToDataURL(blob: Blob): Promise<string> {
    return new Promise((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.readAsDataURL(blob);
    });
}

export function formatBytes(bytes?: number) {
    if (!bytes && bytes !== 0) return "-";
    if (bytes < 1024) return bytes + " B";
    const units = ["KB", "MB", "GB"];
    let val = bytes / 1024;
    let i = 0;
    while (val >= 1024 && i < units.length - 1) {
        val /= 1024;
        i++;
    }
    return val.toFixed(2) + " " + units[i];
}
