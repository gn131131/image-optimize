export interface CompressItemResultSuccess {
    id: string; // client-provided or parsed unique id
    originalName: string;
    mime: string;
    originalSize: number;
    compressedSize: number;
    width?: number;
    height?: number;
    downloadUrl: string; // endpoint to fetch binary
}

export interface CompressItemResultError {
    id: string;
    originalName: string;
    error: string;
}

export type CompressItemResult = CompressItemResultSuccess | CompressItemResultError;

export interface CompressResponse {
    quality: number;
    count: number;
    success: number;
    failed: number;
    items: CompressItemResult[];
}
