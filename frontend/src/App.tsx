import React, { useEffect, useState } from "react";
import UploadArea from "./components/UploadArea";
import ImageItem from "./components/ImageItem";
import QualityPanel from "./components/QualityPanel";
import { QueueItem } from "./types";
import { formatBytes } from "./utils/compress";
import { downloadSingle, downloadZip } from "./utils/download";
import CompareObject from "./components/CompareObject";
import { useTheme, useMessage } from "./hooks";
import { useUploadQueue } from "./useUploadQueue";

const App: React.FC = () => {
    const { theme, toggleTheme } = useTheme();
    const { message, showMsg } = useMessage();
    const { items, setItems, addFiles, remove, clearAll, sendSingleFile, cancelChunk, resumeChunk, batching } = useUploadQueue(showMsg);
    const [compare, setCompare] = useState<QueueItem | null>(null);

    // compare 同步
    useEffect(() => {
        if (!compare && items.length) setCompare(items[0]);
        if (compare) {
            const fresh = items.find((i) => i.id === compare.id);
            if (fresh && fresh !== compare) setCompare(fresh);
        }
    }, [items, compare]);

    const batchDownload = async () => {
        await downloadZip(items.filter((i) => i.compressedBlob && i.lastQuality !== 100));
    };
    const applyQuality = () => {
        if (!compare) return;
        setItems((prev) => prev.map((p) => (p.id === compare.id ? { ...p, recompressing: true } : p)));
        const target = items.find((i) => i.id === compare.id);
        if (target) sendSingleFile({ ...target, recompressing: true } as QueueItem, target.quality);
    };
    const wrappedRemove = (id: string) => {
        const was = compare?.id === id;
        remove(id);
        if (was) setCompare(null);
    };
    const wrappedClear = () => {
        clearAll();
        setCompare(null);
    };

    return (
        <>
            <header>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1.5rem", flexWrap: "wrap" }}>
                    <h1 style={{ fontSize: "1.55rem", letterSpacing: ".5px", margin: 0 }}>图片压缩工具</h1>
                    <button onClick={toggleTheme} className="sm-btn" aria-label="切换主题" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        {theme === "dark" ? "🌙 深色" : "☀️ 浅色"}
                    </button>
                </div>
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
                    <button className="danger" onClick={wrappedClear} disabled={!items.length}>
                        清空队列
                    </button>
                    {/* 取消全局压缩中提示，采用每文件进度+动画显示 */}
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
                            onRemove={wrappedRemove}
                            onDownload={downloadSingle}
                            onRetry={(item) => {
                                setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "pending", error: undefined } : p)));
                                // processedRef handled inside hook, just reset status
                            }}
                            onCancelChunk={cancelChunk}
                            onResumeChunk={resumeChunk}
                        />
                    ))}
                    {/* 空列表时不再显示下方第二拖拽提示，避免视觉重复 */}
                </div>
                <div style={{ marginTop: "2.2rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
                    <div className="compare-area" style={{ width: "100%", display: "flex", justifyContent: "center", position: "relative" }}>
                        <div className="compare-stage" style={{ maxWidth: 900, width: "100%", position: "relative" }}>
                            {compare && compare.compressedBlob ? (
                                <>
                                    <CompareObject compare={compare} />
                                    <div className="quality-dock">
                                        <QualityPanel
                                            item={compare}
                                            onQuality={(v) => {
                                                if (!compare) return;
                                                setItems((prev) => prev.map((p) => (p.id === compare.id ? { ...p, quality: v } : p)));
                                                setCompare((c) => (c && c.id === compare.id ? { ...c, quality: v } : c));
                                            }}
                                            onApply={applyQuality}
                                            disabled={batching}
                                        />
                                    </div>
                                </>
                            ) : (
                                <div className="compare-wrapper empty" />
                            )}
                        </div>
                    </div>
                </div>
            </div>
            <footer style={{ textAlign: "center", padding: "2rem 0", fontSize: ".68rem", opacity: 0.55, lineHeight: 1.5 }}>
                隐私说明：图片仅在内存中即时处理，压缩完成即被清理，不会持久存储或用于模型训练。
            </footer>
        </>
    );
};

export default App;
export {};
