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
            targets.forEach((t) => form.append("files", t.file, t.file.name));
            const url = `${serverUrl}/api/compress?quality=${q}`;
            try {
                const resp = await fetch(url, { method: "POST", body: form });
                if (!resp.ok) throw new Error(`服务器响应 ${resp.status}`);
                const data = await resp.json();
                const map: Record<string, any> = {};
                (data.items || []).forEach((it: any) => {
                    map[it.id] = it;
                });
                setItems((prev) =>
                    prev.map((i) => {
                        const hit = map[i.id];
                        if (!hit) return i;
                        if (hit.error) return { ...i, status: "error", error: hit.error };
                        return { ...i, status: "done", downloadUrl: hit.downloadUrl, compressedSize: hit.compressedSize };
                    })
                );
                // 后续异步获取二进制 Blob (避免阻塞 UI)
                (data.items || []).forEach(async (hit: any) => {
                    if (hit.error) return;
                    try {
                        const bResp = await fetch(`${serverUrl}${hit.downloadUrl}`);
                        if (!bResp.ok) throw new Error("下载失败");
                        const blob = await bResp.blob();
                        setItems((prev) => prev.map((i) => (i.id === hit.id ? { ...i, compressedBlob: blob } : i)));
                    } catch (err: any) {
                        setItems((prev) => prev.map((i) => (i.id === hit.id ? { ...i, status: "error", error: err.message } : i)));
                    }
                });
            } catch (e: any) {
                setItems((prev) => prev.map((i) => (targets.some((t) => t.id === i.id) ? { ...i, status: "error", error: e.message } : i)));
            } finally {
                setBatching(false);
            }
        },
        [serverUrl]
    );

    // base64 已移除

    // 新增或待处理 -> 发送服务器压缩
    useEffect(() => {
        const pendings = items.filter((i) => i.status === "pending");
        if (pendings.length) sendToServer(pendings, quality);
    }, [items, quality, sendToServer]);

    // 质量改变重新压缩（服务端批量）增加 debounce
    const debounceRef = useRef<number | null>(null);
    useEffect(() => {
        if (!autoRecompress) return;
        if (debounceRef.current) window.clearTimeout(debounceRef.current);
        debounceRef.current = window.setTimeout(() => {
            const dones = items.filter((i) => i.status === "done");
            if (dones.length) sendToServer(dones, quality);
        }, 300);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [quality, autoRecompress, items]);

    const remove = (id: string) => {
        setItems((prev) => prev.filter((i) => i.id !== id));
        if (compare?.id === id) setCompare(null);
    };
    const clearAll = () => {
        setItems([]);
        setCompare(null);
    };

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
                        <ImageItem key={it.id} item={it} onPickCompare={setCompare} onRemove={remove} onDownload={downloadSingle} />
                    ))}
                    {!items.length && <div className="empty-hint">暂无图片，拖拽或点击上方区域添加</div>}
                </div>
                <div style={{ marginTop: "2rem" }}>
                    <h3 style={{ margin: "0 0 .5rem" }}>对比</h3>
                    {compare ? (
                        <CompareSlider original={compare.originalDataUrl} compressed={compare.compressedBlob ? URL.createObjectURL(compare.compressedBlob) : undefined} />
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
