import React, { useState, useRef, useEffect, useCallback } from "react";

interface Props {
    original?: string;
    compressed?: string; // object URL 或 base64
}

const CompareSlider: React.FC<Props> = ({ original, compressed }) => {
    const [pos, setPos] = useState(50); // 0-100
    const ref = useRef<HTMLDivElement>(null);
    const draggingRef = useRef(false);
    useEffect(() => {
        setPos(50);
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
    if (!original || !compressed) return null;

    return (
        <div ref={ref} className="compare-wrapper">
            <img src={compressed} alt="compressed" />
            <img src={original} alt="original" className="top" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
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
