import { QueueItem } from "../types";

export interface ChunkUploadOptions {
    serverBase: string; // 不含末尾 /
    chunkSize?: number; // 默认 4MB
    onProgress?: (loaded: number, total: number) => void;
    signal?: AbortSignal;
    quality: number;
    hash?: string; // 预先计算的文件 hash
}

// 初始化分块会话
async function initSession(base: string, file: File, totalChunks: number, quality: number, hash?: string): Promise<any> {
    const resp = await fetch(`${base}/api/upload/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, size: file.size, mime: file.type, totalChunks, quality, hash })
    });
    if (!resp.ok) throw new Error("init失败");
    return resp.json();
}

async function uploadChunk(base: string, uploadId: string, index: number, blob: Blob, signal?: AbortSignal) {
    const form = new FormData();
    form.append("chunk", blob, `chunk-${index}`);
    const resp = await fetch(`${base}/api/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&index=${index}`.replace(/\/\/+api/, "/api"), { method: "POST", body: form, signal });
    if (!resp.ok) throw new Error(`chunk ${index} 失败 ${resp.status}`);
    return resp.json();
}

async function complete(base: string, uploadId: string, quality: number) {
    const resp = await fetch(`${base}/api/upload/complete?uploadId=${encodeURIComponent(uploadId)}&quality=${quality}`.replace(/\/\/+api/, "/api"), { method: "POST" });
    if (!resp.ok) throw new Error("complete失败");
    return resp.json();
}

export async function chunkUploadFile(file: File, opts: ChunkUploadOptions): Promise<any> {
    const chunkSize = opts.chunkSize || 4 * 1024 * 1024;
    const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));
    const init = await initSession(opts.serverBase, file, totalChunks, opts.quality, opts.hash);
    if (init.instant) {
        // 秒传
        return { ...init, uploadId: init.uploadId };
    }
    const uploadId = init.uploadId as string;
    const resumeIndices: Set<number> = new Set(init.receivedIndices || []);
    let sent = 0;
    // 计算已发送字节（断点续传）
    if (resumeIndices.size) {
        sent = init.receivedBytes || 0;
        opts.onProgress?.(sent, file.size);
    }
    for (let i = 0; i < totalChunks; i++) {
        if (opts.signal?.aborted) throw new Error("已取消");
        if (resumeIndices.has(i)) continue; // 跳过已上传块
        const start = i * chunkSize;
        const end = Math.min(file.size, start + chunkSize);
        const slice = file.slice(start, end);
        await uploadChunk(opts.serverBase, uploadId, i, slice, opts.signal);
        sent = end;
        opts.onProgress?.(sent, file.size);
    }
    if (opts.signal?.aborted) throw new Error("已取消");
    const result = await complete(opts.serverBase, uploadId, opts.quality);
    return { ...result, uploadId };
}

// 计算文件哈希 (SHA-256) 分块读取避免一次性占用内存
export async function hashFileSHA256(file: File, chunkSize = 4 * 1024 * 1024): Promise<string> {
    const digest = await (async () => {
        const cryptoObj = crypto || (window as any).crypto;
        if (!cryptoObj?.subtle) throw new Error("当前环境不支持 SubtleCrypto");
        const chunks: ArrayBuffer[] = [];
        for (let offset = 0; offset < file.size; offset += chunkSize) {
            const slice = file.slice(offset, offset + chunkSize);
            const buf = await slice.arrayBuffer();
            chunks.push(buf);
        }
        const full = new Blob(chunks);
        const ab = await full.arrayBuffer();
        const hashBuf = await cryptoObj.subtle.digest("SHA-256", ab);
        const arr = Array.from(new Uint8Array(hashBuf))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
        return arr;
    })();
    return digest;
}
