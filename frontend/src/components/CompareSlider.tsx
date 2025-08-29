import React, { useState, useRef, useEffect, useCallback } from "react";

interface Props {
    original?: string;
    compressed?: string; // object URL 或 base64
}

const CompareSlider: React.FC<Props> = ({ original, compressed }) => {
    const [pos, setPos] = useState(50); // slider position 0-100
    const [nat, setNat] = useState<{ w: number; h: number } | null>(null); // natural image size
    const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 }); // translation in container coords (post-scale wrapper)
    const [scale, setScale] = useState(1);
    const draggingPanRef = useRef(false);
    const panOriginRef = useRef<{ x: number; y: number; startX: number; startY: number }>({ x: 0, y: 0, startX: 0, startY: 0 });
    const ref = useRef<HTMLDivElement>(null);
    const draggingRef = useRef(false);
    useEffect(() => {
        setPos(50);
        setPan({ x: 0, y: 0 });
        setScale(1);
        setNat(null);
        if (original) {
            const img = new Image();
            img.onload = () => setNat({ w: img.naturalWidth, h: img.naturalHeight });
            img.src = original;
        }
    }, [original, compressed]);
    const calcAndSet = useCallback((clientX: number) => {
        if (!ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        const p = ((clientX - rect.left) / rect.width) * 100;
        setPos((prev) => {
            const next = Math.min(100, Math.max(0, p));
            if (next === prev) return prev;
            return next;
        });
    }, []);

    const onPointerDown = (e: React.PointerEvent) => {
        e.preventDefault();
        draggingRef.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        calcAndSet(e.clientX);
    };
    const onPointerMove = (e: React.PointerEvent) => {
        if (!draggingRef.current) return;
        calcAndSet(e.clientX);
    };
    const onPointerUp = (e: React.PointerEvent) => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    };

    // 键盘支持 (左右箭头)
    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowLeft") {
            e.preventDefault();
            setPos((p) => Math.max(0, p - 2));
        } else if (e.key === "ArrowRight") {
            e.preventDefault();
            setPos((p) => Math.min(100, p + 2));
        }
    };
    const onPanPointerDown = (e: React.PointerEvent) => {
        // avoid starting pan when interacting with slider handle
        const target = e.target as HTMLElement;
        if (target.closest(".slider-handle")) return;
        if (e.button !== 0) return;
        e.preventDefault();
        draggingPanRef.current = true;
        const rect = ref.current?.getBoundingClientRect();
        panOriginRef.current = { x: pan.x, y: pan.y, startX: e.clientX, startY: e.clientY };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };
    const onPanPointerMove = (e: React.PointerEvent) => {
        if (!draggingPanRef.current) return;
        const { x, y, startX, startY } = panOriginRef.current;
        let nx = x + (e.clientX - startX);
        let ny = y + (e.clientY - startY);
        // clamp with scale considered
        if (nat && ref.current) {
            const r = ref.current.getBoundingClientRect();
            const scaledW = nat.w * scale;
            const scaledH = nat.h * scale;
            const maxX = 0;
            const maxY = 0;
            const minX = Math.min(0, r.width - scaledW);
            const minY = Math.min(0, r.height - scaledH);
            if (nx > maxX) nx = maxX;
            else if (nx < minX) nx = minX;
            if (ny > maxY) ny = maxY;
            else if (ny < minY) ny = minY;
        }
        setPan({ x: nx, y: ny });
    };
    const endPan = (e: React.PointerEvent) => {
        if (!draggingPanRef.current) return;
        draggingPanRef.current = false;
        try {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {}
    };
    const onDoubleClick = () => {
        setPan({ x: 0, y: 0 });
        setScale(1);
    };

    // Wheel zoom with pointer focus (Ctrl+wheel not required, always zoom)
    const onWheel = (e: React.WheelEvent) => {
        if (!nat || !ref.current) return;
        e.preventDefault();
        const rect = ref.current.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.min(8, Math.max(0.1, scale * zoomFactor));
        if (newScale === scale) return;
        // keep cursor point stable: pan' = c - (c - pan) * (new/newOld)
        const nx = cx - (cx - pan.x) * (newScale / scale);
        const ny = cy - (cy - pan.y) * (newScale / scale);
        // clamp
        let clampedX = nx;
        let clampedY = ny;
        const scaledW = nat.w * newScale;
        const scaledH = nat.h * newScale;
        const minX = Math.min(0, rect.width - scaledW);
        const minY = Math.min(0, rect.height - scaledH);
        if (clampedX > 0) clampedX = 0;
        else if (clampedX < minX) clampedX = minX;
        if (clampedY > 0) clampedY = 0;
        else if (clampedY < minY) clampedY = minY;
        setScale(newScale);
        setPan({ x: clampedX, y: clampedY });
    };

    // compute clip for original image considering pan + scale so slider lines up
    const clipRightPx = (() => {
        if (!nat || !ref.current) return `${100 - pos}%`; // fallback
        const rect = ref.current.getBoundingClientRect();
        const sliderX = (pos / 100) * rect.width; // container coordinate
        const unscaledVisibleX = (sliderX - pan.x) / scale; // coordinate in image space
        const rightInset = nat.w - unscaledVisibleX; // pixels to hide from right
        const clamped = Math.min(Math.max(0, rightInset), nat.w);
        return `inset(0 ${clamped}px 0 0)`;
    })();

    if (!original || !compressed) return null;

    return (
        <div
            ref={ref}
            className="compare-wrapper compare-pan-root"
            onPointerDown={onPanPointerDown}
            onPointerMove={onPanPointerMove}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            onDoubleClick={onDoubleClick}
            onWheel={onWheel}
        >
            <div className={"compare-content" + (draggingPanRef.current ? " dragging" : "")} style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
                <div className="compare-scale" style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
                    <img src={compressed} alt="compressed" draggable={false} />
                    <img src={original} alt="original" className="top" draggable={false} style={{ clipPath: clipRightPx }} />
                </div>
            </div>
            <div className="slider" aria-hidden>
                <div className="slider-bar" style={{ left: pos + "%" }} />
                <div
                    className="slider-handle"
                    style={{ left: pos + "%" }}
                    role="slider"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(pos)}
                    tabIndex={0}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    onKeyDown={onKeyDown}
                />
            </div>
        </div>
    );
};
export default CompareSlider;
