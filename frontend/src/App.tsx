import React, { useState, useCallback } from "react";
import axios from "axios";
import { DropZone } from "./components/DropZone";
import { ImageCard } from "./components/ImageCard";
import { formatSize } from "./utils/format";
import { preprocessImages } from "./utils/preprocess";
import { OptimizedImageInfo } from "./types";

// In production behind nginx reverse proxy we default to same-origin (empty string) so requests hit /api/* proxied by nginx.
const backendBase = import.meta.env.VITE_API_BASE || ""; // e.g. set VITE_API_BASE="http://localhost:4000" for local dev

const App: React.FC = () => {
    const [files, setFiles] = useState<File[]>([]);
    const [quality, setQuality] = useState(75);
    const [format, setFormat] = useState("auto");
    const [multi, setMulti] = useState(false);
    const [stripMeta, setStripMeta] = useState(true);
    const [progress, setProgress] = useState<number>(0);
    const [previewIndex, setPreviewIndex] = useState<number | null>(null);
    const [images, setImages] = useState<OptimizedImageInfo[]>([]);
    const [clientResize, setClientResize] = useState(true);
    const [maxWidth, setMaxWidth] = useState(2400);
    const [maxHeight, setMaxHeight] = useState(2400);
    const [preQuality, setPreQuality] = useState(0.85);
    const [preProgress, setPreProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
    const [preReducedBytes, setPreReducedBytes] = useState<number>(0);
    const [preFiles, setPreFiles] = useState<File[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [summary, setSummary] = useState<{ totalOriginal: number; totalOptimized: number; savedBytes: number; ratio: number } | null>(null);

    const addFiles = useCallback((fs: File[]) => {
        setFiles((prev: File[]) => [...prev, ...fs]);
    }, []);

    const optimize = async () => {
        if (!files.length) return;
        setLoading(true);
        try {
            const uploadList = preFiles || files;
            const form = new FormData();
            uploadList.forEach((f: File) => form.append("files", f));
            form.append("quality", String(quality));
            form.append("format", format);
            form.append("multi", multi ? "1" : "0");
            form.append("stripMeta", stripMeta ? "1" : "0");
            const res = await axios.post(`${backendBase}/api/optimize`, form, {
                headers: { "Content-Type": "multipart/form-data" },
                onUploadProgress: (ev) => {
                    if (ev.total) setProgress(Math.round((ev.loaded / ev.total) * 100));
                }
            });
            setImages(res.data.images);
            setSummary(res.data.summary);
        } catch (e: any) {
            alert("压缩失败: " + e.message);
        } finally {
            setLoading(false);
            setTimeout(() => setProgress(0), 500);
        }
    };

    const downloadZip = async () => {
        if (!files.length) return;
        const uploadList = preFiles || files;
        const form = new FormData();
        uploadList.forEach((f: File) => form.append("files", f));
        form.append("quality", String(quality));
        form.append("format", format);
        form.append("multi", multi ? "1" : "0");
        form.append("stripMeta", stripMeta ? "1" : "0");
        const res = await fetch(`${backendBase}/api/optimize/zip`, { method: "POST", body: form });
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "optimized.zip";
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
            <h1>在线图片压缩</h1>
            <DropZone onFiles={addFiles} />

            {files.length > 0 && (
                <div style={{ marginTop: 24 }}>
                    <h3>待处理文件 ({files.length})</h3>
                    <ul>
                        {files.map((f) => (
                            <li key={f.name}>
                                {f.name} - {formatSize(f.size)}
                            </li>
                        ))}
                    </ul>
                    <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                        <label>
                            质量: <input type="range" min={10} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} /> {quality}
                        </label>
                        <label>
                            格式:{" "}
                            <select value={format} onChange={(e) => setFormat(e.target.value)}>
                                <option value="auto">自动</option>
                                <option value="webp">WebP</option>
                                <option value="avif">AVIF</option>
                                <option value="jpeg">JPEG</option>
                                <option value="png">PNG</option>
                            </select>
                        </label>
                        <label>
                            <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} /> 多格式对比
                        </label>
                        <label>
                            <input type="checkbox" checked={stripMeta} onChange={(e) => setStripMeta(e.target.checked)} /> 去除EXIF
                        </label>
                        <label>
                            <input type="checkbox" checked={clientResize} onChange={(e) => setClientResize(e.target.checked)} /> 客户端预处理
                        </label>
                        {clientResize && (
                            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <input type="number" value={maxWidth} style={{ width: 80 }} onChange={(e) => setMaxWidth(Number(e.target.value) || 0)} />x
                                <input type="number" value={maxHeight} style={{ width: 80 }} onChange={(e) => setMaxHeight(Number(e.target.value) || 0)} />
                                <span>
                                    Q:
                                    <input type="number" min={0.1} max={1} step={0.05} value={preQuality} style={{ width: 70 }} onChange={(e) => setPreQuality(Number(e.target.value))} />
                                </span>
                                <button
                                    type="button"
                                    disabled={!files.length || loading}
                                    onClick={async () => {
                                        setPreProgress({ done: 0, total: files.length });
                                        const result = await preprocessImages(files, { maxWidth, maxHeight, quality: preQuality, format: "auto" }, (d, t) => setPreProgress({ done: d, total: t }));
                                        const reduced = result.reduce((s, r) => s + (r.originalSize - r.processedSize), 0);
                                        setPreReducedBytes(reduced);
                                        setPreFiles(result.map((r) => r.processed));
                                    }}
                                >
                                    预处理压缩
                                </button>
                                {preProgress.total > 0 && preProgress.done < preProgress.total && (
                                    <span style={{ fontSize: 12 }}>
                                        预处理 {preProgress.done}/{preProgress.total}
                                    </span>
                                )}
                            </span>
                        )}
                        <button disabled={loading} onClick={optimize}>
                            {loading ? "处理中..." : "开始压缩"}
                        </button>
                        <button disabled={!images.length && !files.length} onClick={downloadZip} style={{ background: "#0969da" }}>
                            打包下载ZIP
                        </button>
                        {preFiles && <span style={{ fontSize: 12, color: "#58a6ff" }}>已预处理节省 {formatSize(preReducedBytes)}</span>}
                        {loading && <span>上传 {progress}%</span>}
                    </div>
                </div>
            )}

            {summary && (
                <div style={{ marginTop: 24 }}>
                    <h2>汇总</h2>
                    <p>
                        原始总大小: {formatSize(summary.totalOriginal)} → 优化后: {formatSize(summary.totalOptimized)}
                    </p>
                    <p>
                        总节省: {formatSize(summary.savedBytes)} 压缩率: {summary.ratio}%
                    </p>
                </div>
            )}

            {images.length > 0 && (
                <div style={{ marginTop: 32 }}>
                    <h2>压缩结果</h2>
                    <div style={{ display: "grid", gap: 24, gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))" }}>
                        {images.map((img, idx) => (
                            <div key={img.downloadName} style={{ border: "1px solid #30363d", padding: 12, borderRadius: 8 }}>
                                <h4 style={{ marginTop: 0 }}>{img.originalName}</h4>
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    {img.variants?.map((v) => (
                                        <div key={v.format} style={{ textAlign: "center" }}>
                                            <img src={v.base64} style={{ maxWidth: 120, cursor: "zoom-in" }} onClick={() => setPreviewIndex(idx)} />
                                            <div style={{ fontSize: 12 }}>
                                                {v.format} {(v.size / 1024).toFixed(1)}KB
                                            </div>
                                        </div>
                                    )) || <img src={img.base64} style={{ maxWidth: 120 }} />}
                                </div>
                                <p style={{ fontSize: 12, opacity: 0.8 }}>
                                    最佳: {img.format} 压缩率 {img.ratio}% 节省 {formatSize(img.savedBytes)}
                                </p>
                                <a href={img.base64} download={img.downloadName}>
                                    下载最佳
                                </a>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {previewIndex !== null && images[previewIndex] && (
                <div
                    onClick={() => setPreviewIndex(null)}
                    style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
                >
                    <div style={{ maxWidth: "90%", maxHeight: "90%", overflow: "auto" }}>
                        <h3>{images[previewIndex].originalName}</h3>
                        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                            {images[previewIndex].variants?.map((v) => (
                                <div key={v.format} style={{ textAlign: "center" }}>
                                    <img src={v.base64} style={{ maxHeight: "70vh" }} />
                                    <div style={{ fontSize: 12 }}>
                                        {v.format} {(v.size / 1024).toFixed(1)}KB
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;
