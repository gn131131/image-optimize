// 保留与前端展示相关的轻量工具函数（仅转 dataURL 与格式化字节）。
// 之前存在的前端本地压缩函数 compressFile / blobToDataURL 已不再使用（改为全部走后端 sharp），因此移除以减小体积。

export async function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(file);
    });
}

// （已移除 compressFile 与 blobToDataURL）

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
