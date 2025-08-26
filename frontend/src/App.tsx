import React, { useCallback, useEffect, useRef, useState } from "react";
import UploadArea from "./components/UploadArea";
import { QueueItem } from "./types";
import { formatBytes, readFileAsDataUrl } from "./utils/compress";
import { downloadSingle, downloadZip } from "./utils/download";
import ImageItem from "./components/ImageItem";
import CompareSlider from "./components/CompareSlider";

const App: React.FC = () => {
    const [items, setItems] = useState<QueueItem[]>([]);
    const [quality, setQuality] = useState(70);
    const [compare, setCompare] = useState<QueueItem | null>(null);
    const [autoRecompress, setAutoRecompress] = useState(true);
    const [serverUrl] = useState<string>(import.meta.env.VITE_API_BASE || "http://localhost:3001");
    const [batching, setBatching] = useState(false);

    const addFiles = useCallback(
        async (files: File[]) => {
            if (!files.length) return;
            const ALLOWED = ["image/jpeg", "image/png", "image/webp"]; // 与后端一致
            const MAX_SINGLE = 50 * 1024 * 1024;
            const MAX_TOTAL = 200 * 1024 * 1024;
            const existing = items.length;
            const MAX_FILES = 30;
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
                filtered.map(async (f) => ({
                    id: crypto.randomUUID(),
                    file: f,
                    originalSize: f.size,
                    status: "pending",
                    originalDataUrl: await readFileAsDataUrl(f)
                }))
            );
            if (mapped.length) setItems((prev) => [...prev, ...mapped]);
        },
        [items]
    );

    const sendToServer = useCallback(
        async (targets: QueueItem[], q: number) => {
            if (!targets.length) return;
            setBatching(true);
            setItems((prev) => prev.map((i) => (targets.some((t) => t.id === i.id) ? { ...i, status: "compressing", error: undefined } : i)));
            const form = new FormData();
            const ID_SEP = "__IDSEP__"; // 罕见分隔符，嵌入文件名传递 id，防止中文/同名导致映射失败
            targets.forEach((t) => {
                // 通过 multipart 自定义 filename (不修改 File 对象本身) 传递 id
                form.append("files", t.file, `${t.id}${ID_SEP}${t.file.name}`);
            });
            // 仍保留原有映射做向后兼容 (服务器优先使用嵌入 id)
            const clientMap: Record<string, string> = {};
            targets.forEach((t) => (clientMap[t.file.name] = t.id));
            form.append("clientMap", JSON.stringify(clientMap));
            const url = `${serverUrl}/api/compress?quality=${q}`;
            // 取消上一次仍在执行的请求
            if (sendAbortRef.current) {
                sendAbortRef.current.abort();
            }
            const controller = new AbortController();
            sendAbortRef.current = controller;
            try {
                const resp = await fetch(url, { method: "POST", body: form, signal: controller.signal });
                if (!resp.ok) throw new Error(`服务器响应 ${resp.status}`);
                const data = await resp.json();
                const map: Record<string, any> = {};
                const mapName: Record<string, any> = {};
                (data.items || []).forEach((it: any) => {
                    map[it.id] = it;
                    mapName[it.originalName] = it;
                });
                setItems((prev) =>
                    prev.map((i) => {
                        let hit = map[i.id];
                        if (!hit) {
                            // 回退通过文件名匹配（用于排查 id 不一致问题）
                            hit = mapName[i.file.name];
                            if (hit) {
                                console.warn("Fallback matched by originalName; check id mapping for", i.file.name);
                            }
                        }
                        if (!hit) {
                            // 如果没有匹配且仍处在 compressing，标记异常
                            if (i.status === "compressing") {
                                return { ...i, status: "error", error: "no_result" };
                            }
                            return i;
                        }
                        if (hit.error) return { ...i, status: "error", error: hit.error };
                        return { ...i, status: "done", downloadUrl: hit.downloadUrl, compressedSize: hit.compressedSize };
                    })
                );
                // 后续异步获取二进制 Blob (避免阻塞 UI)
                (data.items || []).forEach(async (hit: any) => {
                    if (hit.error) return;
                    try {
                        const bResp = await fetch(`${serverUrl}${hit.downloadUrl}`, { signal: controller.signal });
                        if (!bResp.ok) throw new Error("下载失败");
                        const blob = await bResp.blob();
                        setItems((prev) => prev.map((i) => (i.id === hit.id ? { ...i, compressedBlob: blob } : i)));
                    } catch (err: any) {
                        if (controller.signal.aborted) return; // 忽略取消
                        setItems((prev) => prev.map((i) => (i.id === hit.id ? { ...i, status: "error", error: err.message } : i)));
                    }
                });
            } catch (e: any) {
                if (controller.signal.aborted) {
                    // 还原为 pending 以便下一轮重新处理
                    setItems((prev) => prev.map((i) => (targets.some((t) => t.id === i.id) ? { ...i, status: i.compressedBlob ? "done" : "pending" } : i)));
                    return;
                }
                setItems((prev) => prev.map((i) => (targets.some((t) => t.id === i.id) ? { ...i, status: "error", error: (e as any).message } : i)));
            } finally {
                setBatching(false);
            }
        },
        [serverUrl]
    );

    // base64 已移除

    // 新增或待处理 -> 发送服务器压缩
    const processedRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        const pendings = items.filter((i) => i.status === "pending" && !processedRef.current.has(i.id));
        if (!pendings.length) return;
        pendings.forEach((p) => processedRef.current.add(p.id));
        sendToServer(pendings, quality);
    }, [items, quality, sendToServer]);

    // 质量改变重新压缩（服务端批量）增加 debounce
    const debounceRef = useRef<number | null>(null);
    const lastQualityRef = useRef<number>(quality);
    const sendAbortRef = useRef<AbortController | null>(null);
    useEffect(() => {
        if (!autoRecompress) return;
        if (quality === lastQualityRef.current) return; // 仅在质量真正变化时触发
        lastQualityRef.current = quality;
        if (debounceRef.current) window.clearTimeout(debounceRef.current);
        debounceRef.current = window.setTimeout(() => {
            // 使用当前最新 items (闭包读取) 重新压缩 done 项
            setItems((prev) => {
                const dones = prev.filter((i) => i.status === "done");
                if (dones.length) sendToServer(dones, quality);
                return prev; // 不直接修改，只触发逻辑
            });
        }, 300);
    }, [quality, autoRecompress, sendToServer]);

    const remove = (id: string) => {
        setItems((prev) => prev.filter((i) => i.id !== id));
        if (compare?.id === id) setCompare(null);
    };
    const clearAll = () => {
        setItems([]);
        setCompare(null);
    };

    // compare 选中的条目在 re-compress 后保持同步，自动刷新对比图
    useEffect(() => {
        if (!compare) return;
        const fresh = items.find((i) => i.id === compare.id);
        if (fresh && fresh !== compare) {
            setCompare(fresh);
        }
    }, [items, compare]);

    const batchDownload = async () => {
        await downloadZip(items.filter((i) => i.compressedBlob));
    };

    return (
        <>
            <header>
                <h2>在线图片压缩 (服务端处理)</h2>
            </header>
            <div className="container">
                <UploadArea onFiles={addFiles} />
                <div className="toolbar">
                    <label>
                        质量: <input type="range" min={1} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} /> {quality}
                    </label>
                    <label style={{ fontSize: ".75rem" }}>
                        <input type="checkbox" checked={autoRecompress} onChange={(e) => setAutoRecompress(e.target.checked)} /> 改变质量自动重压缩
                    </label>
                    <button onClick={batchDownload} disabled={!items.some((i) => i.compressedBlob) || batching}>
                        批量下载
                    </button>
                    <button className="danger" onClick={clearAll} disabled={!items.length}>
                        清空队列
                    </button>
                    {batching && <span style={{ fontSize: ".7rem", color: "#4ea1ff" }}>压缩中...</span>}
                    {items.length > 0 && (
                        <span style={{ fontSize: ".75rem", opacity: 0.7 }}>
                            合计原始: {formatBytes(items.reduce((a, b) => a + b.originalSize, 0))} / 压缩后: {formatBytes(items.reduce((a, b) => a + (b.compressedSize || 0), 0))}
                        </span>
                    )}
                </div>
                <div className="images-list grid" style={{ marginTop: "1rem" }}>
                    {items.map((it) => (
                        <ImageItem
                            key={it.id}
                            item={it}
                            onPickCompare={setCompare}
                            onRemove={remove}
                            onDownload={downloadSingle}
                            onRetry={(item) => {
                                setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "pending", error: undefined } : p)));
                                processedRef.current.delete(item.id); // 允许重新发送
                            }}
                        />
                    ))}
                    {!items.length && <div className="empty-hint">暂无图片，拖拽或点击上方区域添加</div>}
                </div>
                <div style={{ marginTop: "2rem" }}>
                    <h3 style={{ margin: "0 0 .5rem" }}>对比</h3>
                    {compare ? (
                        <CompareObject compare={compare} />
                    ) : (
                        <div className="empty-hint" style={{ padding: "1rem", border: "1px dashed #333", borderRadius: 8 }}>
                            选择一张已压缩图片进行对比
                        </div>
                    )}
                </div>
            </div>
            <footer style={{ textAlign: "center", padding: "2rem 0", fontSize: ".7rem", opacity: 0.5 }}>本工具通过服务器端进行压缩，保持输入输出格式一致。</footer>
        </>
    );
};

export default App;

// 独立组件管理 object URL 生命周期
const CompareObject: React.FC<{ compare: QueueItem }> = ({ compare }) => {
    const [url, setUrl] = useState<string | undefined>(undefined);
    useEffect(() => {
        if (compare.compressedBlob) {
            const obj = URL.createObjectURL(compare.compressedBlob);
            setUrl(obj);
            return () => {
                URL.revokeObjectURL(obj);
            };
        } else {
            setUrl(undefined);
        }
    }, [compare.compressedBlob, compare.id, compare.compressedSize]);
    return <CompareSlider original={compare.originalDataUrl} compressed={url} />;
};
