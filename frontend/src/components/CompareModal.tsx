import React, { useState, useEffect, useRef } from "react";
import { OptimizedImageInfo } from "../types";

interface Props {
    open: boolean;
    onClose: () => void;
    image: OptimizedImageInfo | null;
    originalUrl?: string;
}

export const CompareModal: React.FC<Props> = ({ open, onClose, image, originalUrl }) => {
    const [percent, setPercent] = useState(50);
    const [zoom, setZoom] = useState(1);
    const [variant, setVariant] = useState<string | undefined>(undefined);
    const dragRef = useRef(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (image) {
            setVariant(image.format);
            setPercent(50);
            setZoom(1);
        }
    }, [image]);

    if (!open || !image) return null;
    const currentVariant = image.variants?.find((v) => v.format === variant) || image.variants?.[0];
    const optimizedUrl = currentVariant?.base64 || image.base64;

    return (
        <div
            onClick={onClose}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000 }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{ background: "#0d1117", padding: 20, borderRadius: 8, maxWidth: "90%", maxHeight: "90%", display: "flex", flexDirection: "column", gap: 16 }}
            >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <h3 style={{ margin: 0 }}>{image.originalName} 对比</h3>
                    <button onClick={onClose}>关闭</button>
                </div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12 }}>
                    <label>
                        分割: <input type="range" min={0} max={100} value={percent} onChange={(e) => setPercent(Number(e.target.value))} /> {percent}%
                    </label>
                    <label>
                        缩放: <input type="range" min={50} max={300} value={zoom * 100} onChange={(e) => setZoom(Number(e.target.value) / 100)} /> {Math.round(zoom * 100)}%
                    </label>
                    {image.variants && (
                        <label>
                            版本: {" "}
                            <select value={variant} onChange={(e) => setVariant(e.target.value)}>
                                {image.variants.map((v) => (
                                    <option key={v.format} value={v.format}>
                                        {v.format} ({(v.size / 1024).toFixed(1)}KB)
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}
                    <span style={{ opacity: 0.7 }}>
                        原始 {(image.originalSize / 1024).toFixed(1)}KB → 最佳 {(image.optimizedSize / 1024).toFixed(1)}KB 节省 {(image.savedBytes / 1024).toFixed(1)}KB
                    </span>
                </div>
                <div
                    ref={containerRef}
                    style={{ position: "relative", flex: 1, minWidth: 600, minHeight: 300, overflow: "hidden", cursor: "ew-resize", background: "#161b22" }}
                    onMouseDown={(e) => {
                        dragRef.current = true;
                        const rect = containerRef.current!.getBoundingClientRect();
                        setPercent(Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)));
                    }}
                    onMouseMove={(e) => {
                        if (!dragRef.current) return;
                        const rect = containerRef.current!.getBoundingClientRect();
                        setPercent(Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)));
                    }}
                    onMouseUp={() => (dragRef.current = false)}
                    onMouseLeave={() => (dragRef.current = false)}
                >
                    {originalUrl ? (
                        <img
                            src={originalUrl}
                            style={{ position: "absolute", inset: 0, objectFit: "contain", width: "100%", height: "100%", transform: `scale(${zoom})`, transformOrigin: "top left" }}
                        />
                    ) : (
                        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#888" }}>原始图不可用</div>
                    )}
                    <img
                        src={optimizedUrl}
                        style={{ position: "absolute", inset: 0, objectFit: "contain", width: `${100 / zoom}%`, height: `${100 / zoom}%`, transform: `scale(${zoom})`, transformOrigin: "top left", clipPath: `inset(0 ${100 - percent}% 0 0)` }}
                    />
                    <div
                        style={{ position: "absolute", top: 0, bottom: 0, left: `${percent}%`, width: 2, background: "#ffab00", pointerEvents: "none", boxShadow: "0 0 4px rgba(0,0,0,.6)" }}
                    />
                    <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,.5)", padding: "2px 6px", borderRadius: 4, fontSize: 12 }}>原始</div>
                    <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,.5)", padding: "2px 6px", borderRadius: 4, fontSize: 12 }}>优化</div>
                </div>
            </div>
        </div>
    );
};
