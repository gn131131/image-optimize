export interface OptimizedImageInfo {
    originalName: string;
    originalSize: number;
    optimizedSize: number;
    savedBytes: number;
    ratio: number;
    downloadName: string;
    base64: string;
    format?: string;
    variants?: { format: string; size: number; base64: string }[];
}
