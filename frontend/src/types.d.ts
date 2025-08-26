export interface QueueItem {
    id: string;
    file: File;
    originalSize: number; // bytes
    compressedBlob?: Blob;
    compressedSize?: number; // bytes
    originalDataUrl?: string;
    downloadUrl?: string; // server download endpoint
    status: "pending" | "compressing" | "done" | "error";
    error?: string;
}
