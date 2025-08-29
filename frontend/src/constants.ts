// 公共常量与错误码映射
export const ALLOWED_MIME: readonly string[] = ["image/jpeg", "image/png", "image/webp"]; // 仅用于 includes 判定
export const LIMITS = {
    MAX_SINGLE: 50 * 1024 * 1024,
    MAX_TOTAL: 200 * 1024 * 1024,
    MAX_FILES: 30
};

export function mapError(code: string): string {
    switch (code) {
        case "file_too_large":
            return "有文件超过单文件限制 50MB";
        case "too_many_files":
            return "文件数量超过限制";
        case "total_size_exceeded":
            return "总大小超过限制 200MB";
        case "unsupported_type":
            return "包含不支持的文件类型";
        case "dimensions_too_large":
            return "图片像素尺寸过大";
        case "timeout":
            return "处理超时";
        case "cache_overflow":
            return "服务器缓存不足，请稍后再试";
        default:
            return code || "未知错误";
    }
}
