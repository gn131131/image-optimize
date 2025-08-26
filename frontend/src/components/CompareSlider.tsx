import React, { useState, useRef, useEffect } from "react";

interface Props {
    original?: string;
    compressed?: string;
}

const CompareSlider: React.FC<Props> = ({ original, compressed }) => {
    const [pos, setPos] = useState(50);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        setPos(50);
    }, [original, compressed]);
    const onDrag = (e: React.MouseEvent) => {
        if (!ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        const p = ((e.clientX - rect.left) / rect.width) * 100;
        setPos(Math.min(100, Math.max(0, p)));
    };
    if (!original || !compressed) return null;
    return (
        <div ref={ref} className="compare-wrapper" onMouseMove={(e) => e.buttons === 1 && onDrag(e)} onMouseDown={onDrag}>
            <img src={compressed} alt="compressed" />
            <img src={original} alt="original" className="top" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
            <div className="slider" aria-hidden>
                <div className="slider-bar" style={{ left: pos + "%" }} />
                <div className="slider-handle" style={{ left: pos + "%" }} />
            </div>
        </div>
    );
};
export default CompareSlider;
