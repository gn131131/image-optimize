import React, { useRef } from "react";
import { QueueItem } from "../types";
import { downloadSingle } from "../utils/download";
import { formatBytes } from "../utils/compress";

interface ThumbCarouselProps {
    items: QueueItem[];
    selectedId?: string;
    onSelect: (item: QueueItem) => void;
    onRemove: (id: string) => void;
}

const ThumbCarousel: React.FC<ThumbCarouselProps> = ({ items, selectedId, onSelect, onRemove }) => {
    const trackRef = useRef<HTMLDivElement>(null);

    const scrollByCards = (dir: number) => {
        const el = trackRef.current;
        if (!el) return;
        const card = el.querySelector(".thumb-card") as HTMLElement | null;
        const w = card ? card.offsetWidth + 12 : 140; // include gap
        el.scrollBy({ left: dir * w * 3, behavior: "smooth" });
    };

    const renderProgressOverlay = (it: QueueItem) => {
        if (it.status === "done") return null;
        // 复制统一进度映射: 上传 0-60, 压缩 60-100
        let pct = 0;
        if (it.phase === "hash") pct = 5;
        else if (it.phase === "upload") pct = (it.isChunked ? it.chunkProgress || 0 : it.progress || 0) * 60;
        else if (it.phase === "compress") pct = 60 + (it.compressionProgress || 0) * 40;
        else if (it.phase === "download") pct = 100;
        pct = Math.min(100, Math.max(0, Math.round(pct)));
        return (
            <div className="thumb-overlay-progress">
                <div className="thumb-progress-bar">
                    <div className="thumb-progress-fill" style={{ width: pct + "%" }} />
                </div>
                <div className="thumb-progress-text">{pct}%</div>
            </div>
        );
    };

    const renderRatio = (it: QueueItem) => {
        if (!it.compressedSize) return null;
        const diff = it.compressedSize - it.originalSize;
        const pct = (diff / it.originalSize) * 100;
        if (Math.abs(pct) < 0.05) return <span className="ratio neutral">0%</span>;
        if (pct < 0) return <span className="ratio down">↓{Math.abs(pct).toFixed(1)}%</span>;
        return <span className="ratio up">↑{pct.toFixed(1)}%</span>;
    };

    return (
        <div className="thumb-carousel">
            <button className="nav-btn left" onClick={() => scrollByCards(-1)} aria-label="向左">
                ‹
            </button>
            <div className="thumb-viewport">
                <div className="thumb-track" ref={trackRef}>
                    {items.map((it) => {
                        const selected = it.id === selectedId;
                        return (
                            <div key={it.id} className={"thumb-card" + (selected ? " selected" : "")} onClick={() => onSelect(it)}>
                                <div className="thumb-inner">
                                    <img src={it.originalDataUrl} alt={it.file.name} draggable={false} />
                                    {it.status === "done" && <div className="thumb-ratio-fade">{renderRatio(it)}</div>}
                                    {renderProgressOverlay(it)}
                                    <div className="thumb-actions" onClick={(e) => e.stopPropagation()}>
                                        {it.compressedBlob && it.status === "done" && (
                                            <button className="icon-btn" title="下载" onClick={() => downloadSingle(it)}>
                                                ⬇
                                            </button>
                                        )}
                                        <button className="icon-btn danger" title="删除" onClick={() => onRemove(it.id)}>
                                            ✕
                                        </button>
                                    </div>
                                    {it.status === "error" && <div className="thumb-error">失败</div>}
                                </div>
                                {selected && <div className="thumb-focus-ring" />}
                            </div>
                        );
                    })}
                </div>
            </div>
            <button className="nav-btn right" onClick={() => scrollByCards(1)} aria-label="向右">
                ›
            </button>
        </div>
    );
};

export default ThumbCarousel;
