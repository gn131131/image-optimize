export interface CompressItemResultSuccess {
    originalName: string;
    mime: string;
    originalSize: number;
    compressedSize: number;
    width?: number;
    height?: number;
    data?: string; // base64 (may omit in future optimizations)
    id: string; // echo back client-provided id
}

export interface CompressItemResultError {
    originalName: string;
    error: string;
    id: string;
}

export type CompressItemResult = CompressItemResultSuccess | CompressItemResultError;

export interface CompressResponse {
    quality: number;
    count: number;
    success: number;
    failed: number;
    items: CompressItemResult[];
}
