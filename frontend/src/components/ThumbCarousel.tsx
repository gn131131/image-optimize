import React, { useRef, useCallback } from "react";
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

    // 鼠标滚轮 -> 横向滚动
    const onWheel = useCallback((e: React.WheelEvent) => {
        const el = trackRef.current;
        if (!el) return;
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            el.scrollBy({ left: e.deltaY, behavior: "auto" });
            e.preventDefault();
        }
    }, []);

    const renderProgressOverlay = (it: QueueItem) => {
        if (it.status === "done") return null;
        let pct = 0;
        if (it.phase === "hash") pct = 5;
        else if (it.phase === "upload") pct = (it.isChunked ? it.chunkProgress || 0 : it.progress || 0) * 60;
        else if (it.phase === "compress") pct = 60 + (it.compressionProgress || 0) * 40;
        else if (it.phase === "download") pct = 100;
        pct = Math.min(100, Math.max(0, Math.round(pct)));
        const R = 24; // radius
        const C = 2 * Math.PI * R;
        const dash = (pct / 100) * C;
        return (
            <div className="thumb-overlay-progress ring" aria-label={`进度 ${pct}%`}>
                <svg width={60} height={60} className="ring-svg">
                    <circle className="ring-bg" cx={30} cy={30} r={R} />
                    <circle className="ring-fg" cx={30} cy={30} r={R} strokeDasharray={`${dash} ${C - dash}`} />
                </svg>
                <div className="ring-text">{pct}%</div>
            </div>
        );
    };

    const renderRatio = (it: QueueItem) => {
        if (!it.compressedSize) return null;
        const pct = (it.compressedSize / it.originalSize) * 100;
        return <span className="ratio plain">{pct.toFixed(1)}%</span>;
    };

    return (
        <div className="thumb-carousel">
            <button className="nav-btn left" onClick={() => scrollByCards(-1)} aria-label="向左">
                ‹
            </button>
            <div className="thumb-viewport">
                <div className="thumb-track" ref={trackRef} onWheel={onWheel}>
                    {items.map((it) => {
                        const selected = it.id === selectedId;
                        return (
                            <div
                                key={it.id}
                                className={"thumb-card" + (selected ? " selected" : "")}
                                onClick={() => onSelect(it)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        onSelect(it);
                                    }
                                }}
                            >
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
