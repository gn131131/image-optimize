import React, { useCallback, useEffect, useState } from "react";
import UploadArea from "./components/UploadArea";
import { QueueItem } from "./types";
import { compressFile, formatBytes, readFileAsDataUrl } from "./utils/compress";
import { downloadSingle, downloadZip } from "./utils/download";
import ImageItem from "./components/ImageItem";
import CompareSlider from "./components/CompareSlider";

const App: React.FC = () => {
    const [items, setItems] = useState<QueueItem[]>([]);
    const [quality, setQuality] = useState(70);
    const [compare, setCompare] = useState<QueueItem | null>(null);
    const [autoRecompress, setAutoRecompress] = useState(true);

    const addFiles = useCallback(async (files: File[]) => {
        const mapped: QueueItem[] = await Promise.all(
            files.map(async (f) => ({
                id: crypto.randomUUID(),
                file: f,
                originalSize: f.size,
                status: "pending",
                originalDataUrl: await readFileAsDataUrl(f)
            }))
        );
        setItems((prev) => [...prev, ...mapped]);
    }, []);

    const compressOne = useCallback(async (item: QueueItem, q: number) => {
        try {
            setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "compressing" } : i)));
            const { blob, dataUrl } = await compressFile(item.file, { quality: q });
            setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "done", compressedBlob: blob, compressedSize: blob.size, compressedDataUrl: dataUrl } : i)));
        } catch (e: any) {
            setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "error", error: e.message } : i)));
        }
    }, []);

    // 初次或新增项压缩
    useEffect(() => {
        items.filter((i) => i.status === "pending").forEach((i) => compressOne(i, quality));
    }, [items, quality, compressOne]);

    // 质量改变重新压缩
    useEffect(() => {
        if (!autoRecompress) return;
        items.filter((i) => i.status === "done").forEach((i) => compressOne(i, quality));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [quality]);

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
                <h2>在线图片压缩 (本地处理)</h2>
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
                    <button onClick={batchDownload} disabled={!items.some((i) => i.compressedBlob)}>
                        批量下载
                    </button>
                    <button className="danger" onClick={clearAll} disabled={!items.length}>
                        清空队列
                    </button>
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
                        <CompareSlider original={compare.originalDataUrl} compressed={compare.compressedDataUrl} />
                    ) : (
                        <div className="empty-hint" style={{ padding: "1rem", border: "1px dashed #333", borderRadius: 8 }}>
                            选择一张已压缩图片进行对比
                        </div>
                    )}
                </div>
            </div>
            <footer style={{ textAlign: "center", padding: "2rem 0", fontSize: ".7rem", opacity: 0.5 }}>本工具在浏览器本地完成压缩，不上传图片到服务器。</footer>
        </>
    );
};

export default App;
