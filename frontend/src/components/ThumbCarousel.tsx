import React, { useRef, useCallback, useEffect } from "react";
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

    // 非 passive wheel 监听，实现垂直滚动转横向且消除 passive preventDefault 警告
    useEffect(() => {
        const el = trackRef.current;
        if (!el) return;
        let lastDir = 0;
        let lastTime = 0;
        const handler = (e: WheelEvent) => {
            if (!el) return;
            const absY = Math.abs(e.deltaY);
            const absX = Math.abs(e.deltaX);
            if (absY <= absX) return; // 忽略真正横向滚轮
            e.preventDefault();
            // 计算单步宽度 = 3 卡片
            const card = el.querySelector<HTMLElement>(".thumb-card");
            const cardW = card ? card.offsetWidth + 12 : 140; // gap 估算
            const step = cardW * 3;
            const dir = e.deltaY > 0 ? 1 : -1;
            const now = performance.now();
            // 快速连续同向滚动可叠加 (双倍)
            let times = 1;
            if (dir === lastDir && now - lastTime < 260) times = e.shiftKey ? 4 : 2; // Shift 进一步加速
            else if (e.shiftKey) times = 2; // 单次 + Shift
            el.scrollBy({ left: dir * step * times, behavior: "auto" });
            lastDir = dir;
            lastTime = now;
        };
        el.addEventListener("wheel", handler, { passive: false });
        return () => el.removeEventListener("wheel", handler);
    }, []);

    const renderProgressOverlay = (it: QueueItem) => {
        if (it.status === "done" || it.status === "error") return null;
        let pct = 0;
        if (it.phase === "hash") pct = 5;
        else if (it.phase === "upload") pct = (it.isChunked ? it.chunkProgress || 0 : it.progress || 0) * 60;
        else if (it.phase === "compress") pct = 60 + (it.compressionProgress || 0) * 40;
        else if (it.phase === "download") pct = 100;
        pct = Math.min(100, Math.max(0, Math.round(pct)));
        const R = 30; // bigger radius
        const size = 78;
        const C = 2 * Math.PI * R;
        const dash = (pct / 100) * C;
        return (
            <div className="thumb-overlay-progress ring large" aria-label={`进度 ${pct}%`}>
                <svg width={size} height={size} className="ring-svg">
                    <circle className="ring-bg" cx={size / 2} cy={size / 2} r={R} />
                    <circle className="ring-fg" cx={size / 2} cy={size / 2} r={R} strokeDasharray={`${dash} ${C - dash}`} />
                </svg>
                <div className="ring-text big">{pct}%</div>
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
                <div className="thumb-track" ref={trackRef}>
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
                                    {/* 居中放大的下载按钮，仅完成时显示 */}
                                    {it.compressedBlob && it.status === "done" && (
                                        <div className="thumb-center-download" onClick={(e) => e.stopPropagation()}>
                                            <button className="center-dl-btn" title="下载" onClick={() => downloadSingle(it)}>
                                                下载
                                            </button>
                                        </div>
                                    )}
                                    <div className="thumb-actions" onClick={(e) => e.stopPropagation()}>
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
