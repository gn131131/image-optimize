import React, { useState, useEffect, useRef, useCallback } from "react";
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
    const [showDiff, setShowDiff] = useState(false);
    const [diffUrl, setDiffUrl] = useState<string | null>(null);
    const [diffBusy, setDiffBusy] = useState(false);
    const dragRef = useRef(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // 初始化 variant/zoom（记忆上次）
    useEffect(() => {
        if (image) {
            const storedZoom = localStorage.getItem("compare_zoom");
            const storedVariant = localStorage.getItem("compare_variant");
            setPercent(50);
            if (storedZoom) {
                const z = parseFloat(storedZoom);
                if (!Number.isNaN(z) && z >= 0.5 && z <= 3) setZoom(z);
            } else setZoom(1);
            if (storedVariant && image.variants?.some((v) => v.format === storedVariant)) {
                setVariant(storedVariant);
            } else {
                setVariant(image.format);
            }
            setShowDiff(false);
            setDiffUrl(null);
        }
    }, [image]);

    // 持久化 zoom / variant
    useEffect(() => {
        localStorage.setItem("compare_zoom", zoom.toString());
    }, [zoom]);
    useEffect(() => {
        if (variant) localStorage.setItem("compare_variant", variant);
    }, [variant]);

    const computeDiff = useCallback(async (orig: string, opt: string) => {
        setDiffBusy(true);
        try {
            const load = (src: string) =>
                new Promise<HTMLImageElement>((resolve, reject) => {
                    const img = new Image();
                    img.onload = () => resolve(img);
                    img.onerror = reject;
                    img.src = src;
                });
            const [o, p] = await Promise.all([load(orig), load(opt)]);
            const w = Math.min(o.naturalWidth, p.naturalWidth);
            const h = Math.min(o.naturalHeight, p.naturalHeight);
            const maxDim = Math.max(w, h);
            const scale = maxDim > 1600 ? 1600 / maxDim : 1;
            const sw = Math.round(w * scale);
            const sh = Math.round(h * scale);
            const canvas = document.createElement("canvas");
            canvas.width = sw;
            canvas.height = sh;
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(o, 0, 0, sw, sh);
            const origData = ctx.getImageData(0, 0, sw, sh);
            ctx.clearRect(0, 0, sw, sh);
            ctx.drawImage(p, 0, 0, sw, sh);
            const optData = ctx.getImageData(0, 0, sw, sh);
            const diff = ctx.createImageData(sw, sh);
            const threshold = 4; // 低于此灰度差视为无变化
            for (let i = 0; i < diff.data.length; i += 4) {
                const dr = Math.abs(origData.data[i] - optData.data[i]);
                const dg = Math.abs(origData.data[i + 1] - optData.data[i + 1]);
                const db = Math.abs(origData.data[i + 2] - optData.data[i + 2]);
                const d = (dr + dg + db) / 3; // 0-255
                if (d < threshold) {
                    diff.data[i] = 0;
                    diff.data[i + 1] = 0;
                    diff.data[i + 2] = 0;
                    diff.data[i + 3] = 0; // 全透明
                } else {
                    const norm = d / 255; // 0-1
                    // 简单热图: 蓝(低) -> 青 -> 绿 -> 黄 -> 红(高)
                    const r = Math.round(255 * Math.min(1, norm * 2));
                    const g = Math.round(255 * (1 - Math.abs(norm - 0.5) * 2));
                    const b = Math.round(255 * Math.max(0, 1 - norm * 2));
                    diff.data[i] = r;
                    diff.data[i + 1] = g;
                    diff.data[i + 2] = b;
                    diff.data[i + 3] = Math.round(180 * norm + 50); // 透明度梯度
                }
            }
            ctx.clearRect(0, 0, sw, sh);
            ctx.putImageData(diff, 0, 0);
            setDiffUrl(canvas.toDataURL("image/png"));
        } catch (e) {
            console.warn("diff 生成失败", e);
            setDiffUrl(null);
        } finally {
            setDiffBusy(false);
        }
    }, []);

    // 触发生成差异图
    useEffect(() => {
        if (showDiff && originalUrl && image) {
            const currentVariant = image.variants?.find((v) => v.format === variant) || image.variants?.[0];
            const optimizedUrl = currentVariant?.base64 || image.base64;
            computeDiff(originalUrl, optimizedUrl);
        }
    }, [showDiff, originalUrl, image, variant, computeDiff]);

    if (!open || !image) return null;
    const currentVariant = image.variants?.find((v) => v.format === variant) || image.variants?.[0];
    const optimizedUrl = currentVariant?.base64 || image.base64;
    const baseOriginalSize = image.originalSize;
    const baseOptimizedSize = image.optimizedSize;
    const saved = baseOriginalSize - baseOptimizedSize;
    const ratio = baseOptimizedSize / baseOriginalSize;

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
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, alignItems: "center" }}>
                    <label>
                        分割: {" "}
                        <input
                            type="range"
                            min={0}
                            max={100}
                            value={percent}
                            onChange={(e) => setPercent(Number(e.target.value))}
                            disabled={showDiff}
                        /> {percent}%
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
                    <button type="button" onClick={() => setShowDiff((v) => !v)} style={{ cursor: "pointer" }}>
                        {showDiff ? "退出差异热图" : "差异热图"}
                    </button>
                    <span style={{ opacity: 0.7 }}>
                        原始 {(baseOriginalSize / 1024).toFixed(1)}KB → 最佳 {(baseOptimizedSize / 1024).toFixed(1)}KB 节省 {(saved / 1024).toFixed(1)}KB ({((1 - ratio) * 100).toFixed(1)}%)
                    </span>
                </div>
                {/* 统计表 */}
                {image.variants && image.variants.length > 0 && (
                    <div style={{ background: "#161b22", padding: 8, borderRadius: 6, maxHeight: 140, overflow: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                            <thead>
                                <tr style={{ textAlign: "left" }}>
                                    <th style={{ padding: "4px 6px" }}>格式</th>
                                    <th style={{ padding: "4px 6px" }}>大小(KB)</th>
                                    <th style={{ padding: "4px 6px" }}>节省(KB)</th>
                                    <th style={{ padding: "4px 6px" }}>压缩率</th>
                                    <th style={{ padding: "4px 6px" }}>选中</th>
                                </tr>
                            </thead>
                            <tbody>
                                {image.variants.map((v) => {
                                    const save = (baseOriginalSize - v.size) / 1024;
                                    const rr = v.size / baseOriginalSize;
                                    return (
                                        <tr key={v.format} style={{ background: v.format === currentVariant?.format ? "#1f242d" : undefined }}>
                                            <td style={{ padding: "4px 6px" }}>{v.format}</td>
                                            <td style={{ padding: "4px 6px" }}>{(v.size / 1024).toFixed(2)}</td>
                                            <td style={{ padding: "4px 6px" }}>{save.toFixed(2)}</td>
                                            <td style={{ padding: "4px 6px" }}>{((1 - rr) * 100).toFixed(1)}%</td>
                                            <td style={{ padding: "4px 6px" }}>
                                                <input
                                                    type="radio"
                                                    name="variant"
                                                    checked={v.format === currentVariant?.format}
                                                    onChange={() => setVariant(v.format)}
                                                />
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
                <div
                    ref={containerRef}
                    style={{ position: "relative", flex: 1, minWidth: 600, minHeight: 300, overflow: "hidden", cursor: showDiff ? "default" : "ew-resize", background: "#161b22" }}
                    onMouseDown={(e) => {
                        if (showDiff) return;
                        dragRef.current = true;
                        const rect = containerRef.current!.getBoundingClientRect();
                        setPercent(Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)));
                    }}
                    onMouseMove={(e) => {
                        if (showDiff || !dragRef.current) return;
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
                    {!showDiff && (
                        <img
                            src={optimizedUrl}
                            style={{ position: "absolute", inset: 0, objectFit: "contain", width: `${100 / zoom}%`, height: `${100 / zoom}%`, transform: `scale(${zoom})`, transformOrigin: "top left", clipPath: `inset(0 ${100 - percent}% 0 0)` }}
                        />
                    )}
                    {showDiff && (
                        <>
                            {diffBusy && (
                                <div
                                    style={{
                                        position: "absolute",
                                        inset: 0,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        background: "rgba(0,0,0,.4)",
                                        color: "#fff",
                                        fontSize: 14,
                                    }}
                                >
                                    差异计算中...
                                </div>
                            )}
                            {!diffBusy && diffUrl && (
                                <img
                                    src={diffUrl}
                                    style={{
                                        position: "absolute",
                                        inset: 0,
                                        objectFit: "contain",
                                        width: `${100 / zoom}%`,
                                        height: `${100 / zoom}%`,
                                        transform: `scale(${zoom})`,
                                        transformOrigin: "top left",
                                        mixBlendMode: "normal",
                                    }}
                                />
                            )}
                        </>
                    )}
                    {!showDiff && (
                        <div
                            style={{ position: "absolute", top: 0, bottom: 0, left: `${percent}%`, width: 2, background: "#ffab00", pointerEvents: "none", boxShadow: "0 0 4px rgba(0,0,0,.6)" }}
                        />
                    )}
                    <div style={{ position: "absolute", top: 8, left: 8, background: "rgba(0,0,0,.5)", padding: "2px 6px", borderRadius: 4, fontSize: 12 }}>
                        原始
                    </div>
                    <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,.5)", padding: "2px 6px", borderRadius: 4, fontSize: 12 }}>
                        {showDiff ? "差异热图" : "优化"}
                    </div>
                </div>
            </div>
        </div>
    );
};
