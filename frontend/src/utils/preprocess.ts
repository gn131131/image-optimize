export interface PreprocessOptions {
    maxWidth: number;
    maxHeight: number;
    quality: number; // 0-1 for canvas toBlob
    format: "auto" | "jpeg" | "webp" | "original";
}

export interface PreprocessedItem {
    original: File;
    processed: File;
    originalSize: number;
    processedSize: number;
    skipped: boolean; // true if no change
}

function chooseFormat(file: File, format: PreprocessOptions["format"]): { mime: string; ext: string } {
    if (format === "original") return { mime: file.type || "image/png", ext: file.name.split(".").pop() || "png" };
    if (format === "jpeg") return { mime: "image/jpeg", ext: "jpg" };
    if (format === "webp") return { mime: "image/webp", ext: "webp" };
    // auto: keep png if transparent, else webp for others (simplified detection)
    if (file.type === "image/png") return { mime: "image/png", ext: "png" };
    return { mime: "image/webp", ext: "webp" };
}

export async function preprocessImages(
    files: File[],
    opts: PreprocessOptions,
    onProgress?: (done: number, total: number) => void
): Promise<PreprocessedItem[]> {
    const out: PreprocessedItem[] = [];
    let done = 0;
    for (const file of files) {
        try {
            const item = await preprocessSingle(file, opts);
            out.push(item);
        } catch (e) {
            // push original if fail
            out.push({
                original: file,
                processed: file,
                originalSize: file.size,
                processedSize: file.size,
                skipped: true
            });
        }
        done++;
        onProgress?.(done, files.length);
    }
    return out;
}

async function preprocessSingle(file: File, opts: PreprocessOptions): Promise<PreprocessedItem> {
    if (!file.type.startsWith("image/")) {
        return { original: file, processed: file, originalSize: file.size, processedSize: file.size, skipped: true };
    }
    const arrayBuf = await file.arrayBuffer();
    const blob = new Blob([arrayBuf], { type: file.type });
    const img = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const { width, height } = img;
    const scale = Math.min(
        1,
        opts.maxWidth > 0 ? opts.maxWidth / width : 1,
        opts.maxHeight > 0 ? opts.maxHeight / height : 1
    );
    const needResize = scale < 1;
    const targetW = Math.round(width * scale);
    const targetH = Math.round(height * scale);
    const fmt = chooseFormat(file, opts.format);
    const needReencode =
        fmt.mime !== file.type ||
        needResize ||
        (opts.quality < 1 && (fmt.mime === "image/jpeg" || fmt.mime === "image/webp"));
    if (!needReencode) {
        return { original: file, processed: file, originalSize: file.size, processedSize: file.size, skipped: true };
    }
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context not available");
    ctx.drawImage(img, 0, 0, targetW, targetH);
    const blobOut: Blob = await new Promise((resolve, reject) => {
        const q = Math.min(1, Math.max(0.05, opts.quality));
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), fmt.mime, q);
    });
    const processedFile = new File([blobOut], rename(file.name, fmt.ext), { type: fmt.mime, lastModified: Date.now() });
    return {
        original: file,
        processed: processedFile,
        originalSize: file.size,
        processedSize: processedFile.size,
        skipped: false
    };
}

function rename(name: string, ext: string): string {
    const idx = name.lastIndexOf(".");
    const base = idx > -1 ? name.slice(0, idx) : name;
    return `${base}-pre.${ext}`;
}
