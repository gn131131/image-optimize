// 统一生成唯一 ID，兼容不支持 crypto.randomUUID 的环境 (如非安全上下文的老浏览器)
export function generateId(): string {
    try {
        if (typeof crypto !== "undefined") {
            if (typeof (crypto as any).randomUUID === "function") {
                return (crypto as any).randomUUID();
            }
            if (typeof crypto.getRandomValues === "function") {
                const bytes = new Uint8Array(16);
                crypto.getRandomValues(bytes);
                // 按 RFC4122 v4 处理
                bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
                bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
                const toHex: string[] = [];
                for (let i = 0; i < 256; i++) toHex[i] = (i + 0x100).toString(16).slice(1);
                return (
                    toHex[bytes[0]] +
                    toHex[bytes[1]] +
                    toHex[bytes[2]] +
                    toHex[bytes[3]] +
                    "-" +
                    toHex[bytes[4]] +
                    toHex[bytes[5]] +
                    "-" +
                    toHex[bytes[6]] +
                    toHex[bytes[7]] +
                    "-" +
                    toHex[bytes[8]] +
                    toHex[bytes[9]] +
                    "-" +
                    toHex[bytes[10]] +
                    toHex[bytes[11]] +
                    toHex[bytes[12]] +
                    toHex[bytes[13]] +
                    toHex[bytes[14]] +
                    toHex[bytes[15]]
                );
            }
        }
    } catch (_) {
        // ignore and fallback
    }
    // 纯数学随机回退 (碰撞概率略升, 但可接受)
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
