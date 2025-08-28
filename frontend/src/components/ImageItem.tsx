import React from "react";
import { QueueItem } from "../types";
import { formatBytes } from "../utils/compress";

interface Props {
    item: QueueItem;
    selected: boolean;
    onSelect: (item: QueueItem) => void;
    onRemove: (id: string) => void;
    onDownload: (item: QueueItem) => void;
    onRetry?: (item: QueueItem) => void;
    batching: boolean;
    onCancelChunk?: (item: QueueItem) => void;
    onResumeChunk?: (item: QueueItem) => void;
}

const statusColor: Record<string, string> = {
    pending: "#666d78",
    compressing: "#1d6fd9",
    done: "#2f9d59",
    error: "#d9463b"
};
// 状态文字取消，采用左侧色条 + 动画表示

const ImageItem: React.FC<Props> = ({ item, selected, onSelect, onRemove, onDownload, onRetry, batching, onCancelChunk, onResumeChunk }) => {
    const diffPct = item.compressedSize && item.originalSize ? ((item.compressedSize - item.originalSize) / item.originalSize) * 100 : 0;
    let diffEl: React.ReactNode = null;
    if (item.compressedSize) {
        if (Math.abs(diffPct) < 0.05) {
            diffEl = <span style={{ color: "#b0bac5" }}>0.0%</span>;
        } else if (diffPct < 0) {
            diffEl = <span style={{ color: "#4caf50" }}>↓{Math.abs(diffPct).toFixed(1)}%</span>;
        } else {
            diffEl = <span style={{ color: "#ffb347" }}>↑{diffPct.toFixed(1)}%</span>;
        }
    }
    return (
        <div className={`image-item status-${item.status} ${selected ? "selected" : ""}`} onClick={() => onSelect(item)} style={{ cursor: "pointer" }}>
            <div className="status-bar" />
            <img className="thumb" src={item.originalDataUrl} alt="thumb" />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }} className="file-name-row">
                    <strong className="file-name" style={{ wordBreak: "break-all", flex: 1 }}>
                        {item.file.name}
                    </strong>
                </div>
                <div className="size-diff meta-line" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                    <span>
                        {formatBytes(item.originalSize)} → {item.compressedSize ? formatBytes(item.compressedSize) : "-"}
                    </span>
                    {diffEl}
                    <span className="quality-pill" style={{ marginLeft: "auto" }}>
                        {item.lastQuality === 100 || item.quality === 100 ? "原图" : `Q:${item.quality}`}
                    </span>
                </div>
                {/* 分块上传进度 */}
                {item.isChunked && item.status === "compressing" && typeof item.chunkProgress === "number" && item.chunkProgress < 1 && (
                    <div style={{ height: 4, background: "#2b2f36", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: `${(item.chunkProgress * 100).toFixed(1)}%`, background: "#1d6fd9", height: "100%", transition: "width .25s linear" }} />
                    </div>
                )}
                {item.error && <div style={{ color: "#ff6b6b", fontSize: ".68rem" }}>{item.error}</div>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }} onClick={(e) => e.stopPropagation()} className="item-actions">
                <button onClick={() => onDownload(item)} disabled={!item.compressedBlob || item.status !== "done" || item.lastQuality === 100} className="sm-btn">
                    下载
                </button>
                {item.status === "error" && onRetry && (
                    <button onClick={() => onRetry(item)} className="sm-btn">
                        重试
                    </button>
                )}
                {item.isChunked && item.status === "compressing" && !item.canceled && (
                    <button className="sm-btn" onClick={() => onCancelChunk?.(item)} disabled={item.chunkProgress === 1}>
                        取消
                    </button>
                )}
                {item.isChunked && item.canceled && item.status !== "done" && (
                    <button className="sm-btn" onClick={() => onResumeChunk?.(item)}>
                        继续
                    </button>
                )}
                <button className="danger sm-btn" onClick={() => onRemove(item.id)}>
                    删除
                </button>
            </div>
        </div>
    );
};

export default ImageItem;
