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
    // 分块上传相关（大文件时使用）
    chunkUploadId?: string; // 服务端 uploadId
    chunkProgress?: number; // 0-1 上传进度
    isChunked?: boolean; // 是否走分块流程
    chunkAbort?: AbortController; // 当前分块上传控制器
    canceled?: boolean; // 用户取消
}
