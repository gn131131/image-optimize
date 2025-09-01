import React, { useEffect, useState, useMemo } from "react";
import UploadArea from "./components/UploadArea";
// import ImageItem from "./components/ImageItem"; // legacy list view
import ThumbCarousel from "./components/ThumbCarousel";
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
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const selectedItem: QueueItem | null = useMemo(() => (selectedId ? items.find((i) => i.id === selectedId) || null : null), [items, selectedId]);

    // 初次或列表变化时，如未选择则自动选择第一个已完成文件
    useEffect(() => {
        if (!selectedId) {
            const firstDone = items.find((i) => i.status === "done");
            if (firstDone) setSelectedId(firstDone.id);
            return;
        }
        // 如果当前选择被删除则清空
        if (selectedId && !items.some((i) => i.id === selectedId)) setSelectedId(null);
    }, [items, selectedId]);

    const batchDownload = async () => {
        const success = items.filter((i) => i.status === "done" && i.compressedBlob);
        if (!success.length) return;
        await downloadZip(success);
    };
    const applyQuality = () => {
        if (!selectedItem) return;
        // 标记重新压缩：保留旧 compressedBlob 供对比区显示，同时重置内部 _fetched 标志以便重新获取
        setItems((prev) =>
            prev.map((p) =>
                p.id === selectedItem.id
                    ? ({
                          ...p,
                          recompressing: true,
                          // 清理可能遗留的内部标志（不会影响 TS，因为是动态属性）
                          _fetched: false,
                          _fetching: false
                      } as any)
                    : p
            )
        );
        const target = items.find((i) => i.id === selectedItem.id);
        if (target) sendSingleFile({ ...target, recompressing: true } as QueueItem, target.quality);
    };
    const wrappedRemove = (id: string) => {
        const was = selectedId === id;
        remove(id);
        if (was) setSelectedId(null);
    };
    const wrappedClear = () => {
        clearAll();
        setSelectedId(null);
    };

    // 过滤可下载数量
    const downloadableCount = items.filter((i) => i.status === "done" && i.compressedBlob).length;

    // 如果已选文件进入错误或非 done 状态，不显示信息/对比区（渲染时条件控制）；如 error 则保留 selectedId 但 UI 隐藏

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
                {items.length > 0 && (
                    <>
                        <div className="toolbar">
                            <button onClick={batchDownload} disabled={!downloadableCount || batching} className="with-badge">
                                批量下载
                                {downloadableCount > 0 && (
                                    <span className="btn-badge" aria-label="可下载数量">
                                        {downloadableCount}
                                    </span>
                                )}
                            </button>
                            <button className="danger" onClick={wrappedClear} disabled={!items.length}>
                                清空队列
                            </button>
                            <span style={{ fontSize: ".78rem", opacity: 0.75, whiteSpace: "nowrap" }}>
                                合计原始: {formatBytes(items.reduce((a, b) => a + b.originalSize, 0))} / 压缩后: {formatBytes(items.reduce((a, b) => a + (b.compressedSize || 0), 0))}
                            </span>
                            {selectedItem && selectedItem.status === "done" && (
                                <span className="selected-file-pill" title={selectedItem.file.name}>
                                    <span className="sfp-name">{selectedItem.file.name}</span>
                                    {selectedItem.compressedSize && (
                                        <>
                                            <span className="sfp-size">{formatBytes(selectedItem.originalSize)}</span>
                                            <span className="sfp-arrow">→</span>
                                            <span className="sfp-size">{formatBytes(selectedItem.compressedSize)}</span>
                                            <span className="sfp-ratio">{((selectedItem.compressedSize / selectedItem.originalSize) * 100).toFixed(1)}%</span>
                                        </>
                                    )}
                                </span>
                            )}
                        </div>
                        <ThumbCarousel
                            items={items}
                            selectedId={selectedId || undefined}
                            onSelect={(it) => {
                                if (it.status !== "done") return; // 只有成功文件可以选中
                                setSelectedId(it.id);
                            }}
                            onRemove={wrappedRemove}
                        />
                        {/* 显示条件：已有一次压缩结果(有 compressedBlob) 且未进入 error，即使正在重新压缩也保持可见 */}
                        {selectedItem && selectedItem.compressedBlob && selectedItem.status !== "error" && (
                            <div style={{ marginTop: "2.2rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
                                <div className="compare-area" style={{ width: "100%", display: "flex", justifyContent: "center", position: "relative" }}>
                                    <div className="compare-stage" style={{ maxWidth: 900, width: "100%", position: "relative" }}>
                                        {selectedItem && selectedItem.compressedBlob ? (
                                            <>
                                                <CompareObject compare={selectedItem} />
                                                <div className="quality-dock">
                                                    <QualityPanel
                                                        item={selectedItem}
                                                        onQuality={(v) => {
                                                            if (!selectedItem) return;
                                                            setItems((prev) => prev.map((p) => (p.id === selectedItem.id ? { ...p, quality: v } : p)));
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
                        )}
                    </>
                )}
            </div>
            <footer style={{ textAlign: "center", padding: "2rem 0", fontSize: ".68rem", opacity: 0.55, lineHeight: 1.5 }}>
                隐私说明：图片仅在内存中即时处理，压缩完成即被清理，不会持久存储或用于模型训练。
            </footer>
        </>
    );
};

export default App;
export {};
