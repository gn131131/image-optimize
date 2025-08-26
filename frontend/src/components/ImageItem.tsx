import React from "react";
import { QueueItem } from "../types";
import { formatBytes } from "../utils/compress";

interface Props {
    item: QueueItem;
    onPickCompare: (item: QueueItem) => void;
    onRemove: (id: string) => void;
    onDownload: (item: QueueItem) => void;
}

const ImageItem: React.FC<Props> = ({ item, onPickCompare, onRemove, onDownload }) => {
    const ratio = item.compressedSize && item.originalSize ? 100 - (item.compressedSize / item.originalSize) * 100 : 0;
    return (
        <div className="image-item">
            <img className="thumb" src={item.originalDataUrl} alt="thumb" />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong style={{ fontSize: ".8rem", wordBreak: "break-all" }}>{item.file.name}</strong>
                    <span className="badge">{item.status}</span>
                </div>
                <div className="size-diff">
                    {formatBytes(item.originalSize)} → {item.compressedSize ? formatBytes(item.compressedSize) : "-"}{" "}
                    {item.compressedSize && <span style={{ color: "#4caf50" }}> (↓{ratio.toFixed(1)}%)</span>}
                </div>
                {item.error && <div style={{ color: "#ff6b6b", fontSize: ".7rem" }}>{item.error}</div>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <button onClick={() => onPickCompare(item)} disabled={!item.compressedBlob}>
                    对比
                </button>
                <button onClick={() => onDownload(item)} disabled={!item.compressedBlob}>
                    下载
                </button>
                <button className="danger" onClick={() => onRemove(item.id)}>
                    删除
                </button>
            </div>
        </div>
    );
};

export default ImageItem;
