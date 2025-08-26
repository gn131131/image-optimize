export interface QueueItem {
    id: string;
    file: File;
    originalSize: number; // bytes
    compressedBlob?: Blob;
    compressedSize?: number; // bytes
    originalDataUrl?: string;
    downloadUrl?: string; // server download endpoint
    quality: number; // 当前该文件的目标质量
    lastQuality: number; // 上一次已应用并压缩成功/尝试的质量
    recompressing?: boolean; // 正在重新压缩但仍展示旧结果以减少闪烁
    status: "pending" | "compressing" | "done" | "error";
    error?: string;
}
