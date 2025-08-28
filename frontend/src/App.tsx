import React, { useCallback, useEffect, useRef, useState } from "react";
import UploadArea from "./components/UploadArea";
import { QueueItem } from "./types";
import { formatBytes, readFileAsDataUrl } from "./utils/compress";
import { downloadSingle, downloadZip } from "./utils/download";
import ImageItem from "./components/ImageItem";
import CompareSlider from "./components/CompareSlider";
import { generateId } from "./utils/uuid";

function mapError(code: string): string {
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

const App: React.FC = () => {
    const [items, setItems] = useState<QueueItem[]>([]);
    const [compare, setCompare] = useState<QueueItem | null>(null);
    // 后端基址：
    // 优先使用 VITE_API_BASE；未设置时在生产回退到同源(使用相对路径)，在开发回退到 http://localhost:3001
    const [serverUrl] = useState<string>(() => {
        const raw = (import.meta as any).env?.VITE_API_BASE as string | undefined;
        if (raw && raw.trim()) return raw.replace(/\/$/, "");
        if (typeof window !== "undefined" && window.location.hostname !== "localhost") {
            // 生产：同源，相对路径空串即可
            return ""; // 这样 fetch 时会生成 /api/xxx
        }
        return "http://localhost:3001"; // 开发默认
    });
    const [batching, setBatching] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const showMsg = useCallback((m: string) => {
        setMessage(m);
        setTimeout(() => setMessage((cur) => (cur === m ? null : cur)), 4000);
    }, []);

    // --- 添加文件（初始 pending，稍后批量发送） ---
    const addFiles = useCallback(
        async (files: File[]) => {
            if (!files.length) return;
            const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
            const MAX_SINGLE = 50 * 1024 * 1024;
            const MAX_TOTAL = 200 * 1024 * 1024;
            const MAX_FILES = 30;
            const existing = items.length;
            const filtered: File[] = [];
            let totalAdd = 0;
            for (const f of files) {
                if (!ALLOWED.includes(f.type)) continue;
                if (f.size > MAX_SINGLE) continue;
                if (existing + filtered.length >= MAX_FILES) break;
                if (totalAdd + f.size > MAX_TOTAL) break;
                filtered.push(f);
                totalAdd += f.size;
            }
            const mapped: QueueItem[] = await Promise.all(
                filtered.map(async (f) => {
                    // 依据格式选一个近乎无损的缺省质量 (经验值)
                    let dq = 70; // 回退
                    if (f.type.includes("jpeg")) dq = 85; // JPEG 80~85 视觉接近原图
                    else if (f.type.includes("png")) dq = 85; // PNG palette 时质量影响量化，可取较高
                    else if (f.type.includes("webp")) dq = 80; // WebP 80 基本接近原图
                    return {
                        id: generateId(),
                        file: f,
                        originalSize: f.size,
                        quality: dq,
                        lastQuality: dq,
                        status: "pending",
                        originalDataUrl: await readFileAsDataUrl(f)
                    } as QueueItem;
                })
            );
            if (mapped.length) {
                setItems((prev) => {
                    const next = [...prev, ...mapped];
                    if (!compare && next.length) setCompare(next[0]);
                    return next;
                });
            }
        },
        [items, compare]
    );

    // --- 发送压缩请求 ---
    const sendAbortRef = useRef<AbortController | null>(null);
    const sendToServer = useCallback(
        async (targets: QueueItem[], q: number) => {
            if (!targets.length) return;
            setBatching(true);
            const targetIds = new Set(targets.map((t) => t.id));
            setItems((prev) =>
                prev.map((i) => {
                    if (!targetIds.has(i.id)) return i;
                    // 重新压缩且已有结果: 保留原图显示不改 compressed 状态, 只标记 recompressing
                    if (i.recompressing && i.compressedBlob) return { ...i, error: undefined };
                    return { ...i, status: "compressing", error: undefined };
                })
            );
            const form = new FormData();
            const ID_SEP = "__IDSEP__";
            targets.forEach((t) => form.append("files", t.file, `${t.id}${ID_SEP}${t.file.name}`));
            const clientMap: Record<string, string> = {};
            targets.forEach((t) => (clientMap[t.file.name] = t.id));
            form.append("clientMap", JSON.stringify(clientMap));
            const url = `${serverUrl}/api/compress?quality=${q}`.replace(/\/\/api/, "/api"); // 防止出现 //api
            if (sendAbortRef.current) sendAbortRef.current.abort();
            const controller = new AbortController();
            sendAbortRef.current = controller;
            try {
                const resp = await fetch(url, { method: "POST", body: form, signal: controller.signal });
                if (!resp.ok) {
                    let errText = `服务器响应 ${resp.status}`;
                    try {
                        const js = await resp.json();
                        if (js?.error) errText = mapError(js.error);
                    } catch {}
                    throw new Error(errText);
                }
                const data = await resp.json();
                const map: Record<string, any> = {};
                const nameMap: Record<string, any> = {};
                (data.items || []).forEach((it: any) => {
                    map[it.id] = it;
                    nameMap[it.originalName] = it;
                });
                // 先更新元数据（不替换 blob）
                setItems((prev) =>
                    prev.map((i) => {
                        const hit = map[i.id] || nameMap[i.file.name];
                        if (!hit) return i;
                        if (hit.error) return { ...i, status: "error", error: hit.error, recompressing: false };
                        return { ...i, compressedSize: hit.compressedSize, downloadUrl: hit.downloadUrl, status: i.compressedBlob ? "done" : "done" };
                    })
                );
                // 下载新 blob
                const ts = Date.now();
                (data.items || []).forEach(async (hit: any) => {
                    if (hit.error) return;
                    try {
                        const bResp = await fetch(`${serverUrl}${hit.downloadUrl}?t=${ts}`, { signal: controller.signal });
                        if (!bResp.ok) throw new Error("下载失败");
                        const blob = await bResp.blob();
                        setItems((prev) => prev.map((i) => (i.id === hit.id ? { ...i, compressedBlob: blob, lastQuality: i.quality, recompressing: false, status: "done" } : i)));
                    } catch (err: any) {
                        if (controller.signal.aborted) return;
                        setItems((prev) => prev.map((i) => (i.id === hit.id ? { ...i, status: "error", error: err.message, recompressing: false } : i)));
                    }
                });
            } catch (e: any) {
                if ((e as any).name === "AbortError") return; // 忽略取消
                showMsg((e as any).message || "上传失败");
                setItems((prev) => prev.map((i) => (targetIds.has(i.id) ? { ...i, status: "error", error: (e as any).message, recompressing: false } : i)));
            } finally {
                setBatching(false);
            }
        },
        [serverUrl, showMsg]
    );

    // --- 处理新 pending 项批量发送 ---
    const processedRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        const pendings = items.filter((i) => i.status === "pending" && !processedRef.current.has(i.id));
        if (!pendings.length) return;
        pendings.forEach((p) => processedRef.current.add(p.id));
        const groups = new Map<number, QueueItem[]>();
        pendings.forEach((p) => {
            const g = groups.get(p.quality) || [];
            g.push(p);
            groups.set(p.quality, g);
        });
        groups.forEach((group, q) => sendToServer(group, q));
    }, [items, sendToServer]);

    // --- 删除/清空 ---
    const remove = (id: string) => {
        setItems((prev) => prev.filter((i) => i.id !== id));
        if (compare?.id === id) setCompare(null);
    };
    const clearAll = () => {
        setItems([]);
        setCompare(null);
    };

    // --- compare 同步 ---
    useEffect(() => {
        if (!compare && items.length) setCompare(items[0]);
        if (compare) {
            const fresh = items.find((i) => i.id === compare.id);
            if (fresh && fresh !== compare) setCompare(fresh);
        }
    }, [items, compare]);

    // --- 批量下载 ---
    const batchDownload = async () => {
        await downloadZip(items.filter((i) => i.compressedBlob && i.lastQuality !== 100));
    };

    // --- 应用质量（重新压缩） ---
    const applyQuality = () => {
        if (!compare) return;
        setItems((prev) => prev.map((p) => (p.id === compare.id ? { ...p, recompressing: true } : p)));
        const target = items.find((i) => i.id === compare.id);
        if (target) sendToServer([{ ...target, recompressing: true }], target.quality);
    };

    return (
        <>
            <header>
                <h2>在线图片压缩 (服务端处理)</h2>
            </header>
            <div className="container">
                <UploadArea onFiles={addFiles} onRejectInfo={showMsg} />
                {message && (
                    <div
                        style={{
                            position: "fixed",
                            top: 12,
                            right: 12,
                            background: "#222",
                            color: "#fff",
                            padding: "8px 14px",
                            borderRadius: 6,
                            fontSize: ".75rem",
                            boxShadow: "0 4px 14px rgba(0,0,0,.3)"
                        }}
                    >
                        {message}
                    </div>
                )}
                <div className="toolbar">
                    <button onClick={batchDownload} disabled={!items.some((i) => i.compressedBlob) || batching}>
                        批量下载
                    </button>
                    <button className="danger" onClick={clearAll} disabled={!items.length}>
                        清空队列
                    </button>
                    {batching && <span style={{ fontSize: ".7rem", color: "#4ea1ff" }}>压缩中...</span>}
                    {items.length > 0 && (
                        <span style={{ fontSize: ".78rem", opacity: 0.75 }}>
                            合计原始: {formatBytes(items.reduce((a, b) => a + b.originalSize, 0))} / 压缩后: {formatBytes(items.reduce((a, b) => a + (b.compressedSize || 0), 0))}
                        </span>
                    )}
                </div>
                <div className="images-list grid" style={{ marginTop: "1rem" }}>
                    {items.map((it) => (
                        <ImageItem
                            key={it.id}
                            item={it}
                            selected={compare?.id === it.id}
                            batching={batching}
                            onSelect={(item) => setCompare(item)}
                            onRemove={remove}
                            onDownload={downloadSingle}
                            onRetry={(item) => {
                                setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "pending", error: undefined } : p)));
                                processedRef.current.delete(item.id);
                            }}
                        />
                    ))}
                    {!items.length && <div className="empty-hint">暂无图片，拖拽或点击上方区域添加</div>}
                </div>
                <div style={{ marginTop: "2.2rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
                    {compare ? (
                        <>
                            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                                <label style={{ fontSize: ".85rem" }}>质量</label>
                                <input
                                    type="range"
                                    min={1}
                                    max={100}
                                    value={compare.quality}
                                    onChange={(e) => {
                                        const v = Number(e.target.value);
                                        setItems((prev) => prev.map((p) => (p.id === compare.id ? { ...p, quality: v } : p)));
                                        setCompare((c) => (c && c.id === compare.id ? { ...c, quality: v } : c));
                                    }}
                                    style={{ width: 360 }}
                                />
                                <span style={{ fontSize: ".85rem", width: 40, textAlign: "center", fontWeight: 600 }}>{compare.quality}</span>
                                <button
                                    className="primary"
                                    style={{ padding: ".46rem .95rem" }}
                                    disabled={batching || compare.recompressing || compare.quality === compare.lastQuality}
                                    onClick={applyQuality}
                                >
                                    应用
                                </button>
                                {compare.recompressing && <span style={{ fontSize: ".65rem", color: "#4ea1ff" }}>重新压缩中...</span>}
                            </div>
                            <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
                                <div style={{ transform: "scale(1.05)", maxWidth: 900, width: "100%" }}>
                                    <CompareObject compare={compare} />
                                </div>
                            </div>
                        </>
                    ) : items.length ? (
                        <div className="empty-hint" style={{ padding: "1rem", border: "1px dashed #333", borderRadius: 8 }}>
                            请选择图片
                        </div>
                    ) : (
                        <div className="empty-hint" style={{ padding: "2rem", border: "1px dashed #333", borderRadius: 8 }}>
                            上传图片后这里显示实时对比
                        </div>
                    )}
                </div>
            </div>
            <footer style={{ textAlign: "center", padding: "2rem 0", fontSize: ".7rem", opacity: 0.5 }}>本工具通过服务器端进行压缩，保持输入输出格式一致。</footer>
        </>
    );
};

export default App;

// --- 独立组件: 管理 object URL 生命周期 ---
const CompareObject: React.FC<{ compare: QueueItem }> = ({ compare }) => {
    const [url, setUrl] = useState<string | undefined>();
    useEffect(() => {
        if (compare.compressedBlob) {
            const obj = URL.createObjectURL(compare.compressedBlob);
            setUrl(obj);
            return () => URL.revokeObjectURL(obj);
        }
        setUrl(undefined);
    }, [compare.compressedBlob, compare.id, compare.compressedSize]);
    return <CompareSlider original={compare.originalDataUrl} compressed={url} />;
};

export {};
