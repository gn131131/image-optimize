import React, { useCallback, useEffect, useRef, useState } from "react";
import UploadArea from "./components/UploadArea";
import { QueueItem } from "./types";
import { formatBytes, readFileAsDataUrl } from "./utils/compress";
import { downloadSingle, downloadZip } from "./utils/download";
import ImageItem from "./components/ImageItem";
import CompareSlider from "./components/CompareSlider";
import QualityPanel from "./components/QualityPanel";
import { generateId } from "./utils/uuid";
import { chunkUploadFile, hashFileSHA256 } from "./utils/chunkUpload";

// 允许的图片类型与大小限制（前后端需保持一致）
const ALLOWED_MIME: readonly string[] = ["image/jpeg", "image/png", "image/webp"]; // 仅用于 includes 判定
const LIMITS = {
    MAX_SINGLE: 50 * 1024 * 1024,
    MAX_TOTAL: 200 * 1024 * 1024,
    MAX_FILES: 30
};

function mapError(code: string): string {
    switch (code) {
        case "file_too_large":
            return "有文件超过单文件限制 50MB";
        case "too_many_files":
            return "文件数量超过限制";
        case "total_size_exceeded":
            return "总大小超过限制 200MB";
        case "unsupported_type":
            return "包含不支持的文件类型";
        case "dimensions_too_large":
            return "图片像素尺寸过大";
        case "timeout":
            return "处理超时";
        case "cache_overflow":
            return "服务器缓存不足，请稍后再试";
        default:
            return code || "未知错误";
    }
}

const App: React.FC = () => {
    const [items, setItems] = useState<QueueItem[]>([]);
    const [compare, setCompare] = useState<QueueItem | null>(null);
    const [theme, setTheme] = useState<"dark" | "light">(() => (typeof localStorage !== "undefined" ? (localStorage.getItem("theme") as "dark" | "light") || "dark" : "dark"));
    // 后端基址：
    // 优先使用 VITE_API_BASE；未设置时在生产回退到同源(使用相对路径)，在开发回退到 http://localhost:3001
    const [serverUrl] = useState<string>(() => {
        const raw = (import.meta as any).env?.VITE_API_BASE as string | undefined;
        if (raw && raw.trim()) return raw.replace(/\/$/, "");
        if (typeof window !== "undefined" && window.location.hostname !== "localhost") {
            // 生产：同源，相对路径空串即可
            return ""; // 这样 fetch 时会生成 /api/xxx
        }
        return "http://localhost:3001"; // 开发默认
    });
    // 是否存在正在处理的任务（普通文件单独上传/分块上传/重新压缩）
    const [batching, setBatching] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const showMsg = useCallback((m: string) => {
        setMessage(m);
        setTimeout(() => setMessage((cur) => (cur === m ? null : cur)), 4000);
    }, []);

    // 应用主题到 html data-theme
    useEffect(() => {
        document.documentElement.dataset.theme = theme;
        try {
            localStorage.setItem("theme", theme);
        } catch {}
    }, [theme]);

    const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

    // --- 添加文件（初始 pending，稍后批量发送） ---
    const addFiles = useCallback(
        async (files: File[]) => {
            if (!files.length) return;
            const existing = items.length;
            const filtered: File[] = [];
            let totalAdd = 0;
            for (const f of files) {
                if (!ALLOWED_MIME.includes(f.type)) continue;
                if (f.size > LIMITS.MAX_SINGLE) continue;
                if (existing + filtered.length >= LIMITS.MAX_FILES) break;
                if (totalAdd + f.size > LIMITS.MAX_TOTAL) break;
                filtered.push(f);
                totalAdd += f.size;
            }
            const mapped: QueueItem[] = await Promise.all(
                filtered.map(async (f) => {
                    // 依据格式选一个近乎无损的缺省质量 (经验值)
                    let dq = 70; // 回退
                    if (f.type.includes("jpeg")) dq = 85; // JPEG 80~85 视觉接近原图
                    else if (f.type.includes("png")) dq = 85; // PNG palette 时质量影响量化，可取较高
                    else if (f.type.includes("webp")) dq = 80; // WebP 80 基本接近原图
                    const isChunked = f.size > LIMITS.MAX_SINGLE; // 超过普通接口限制则走分块
                    return {
                        id: generateId(),
                        file: f,
                        originalSize: f.size,
                        quality: dq,
                        lastQuality: dq,
                        status: isChunked ? "compressing" : "pending",
                        originalDataUrl: await readFileAsDataUrl(f),
                        isChunked,
                        chunkProgress: isChunked ? 0 : undefined,
                        phase: isChunked ? "hash" : undefined,
                        uploadPercent: isChunked ? 0 : undefined
                    } as QueueItem;
                })
            );
            if (mapped.length) {
                setItems((prev) => {
                    const next = [...prev, ...mapped];
                    if (!compare && next.length) setCompare(next[0]);
                    return next;
                });
            }
        },
        [items, compare]
    );

    // --- 发送压缩请求 ---
    // 单文件上传并压缩（非分块）
    const activeUploadsRef = useRef(0);
    const sendSingleFile = useCallback(
        async (target: QueueItem, quality: number) => {
            setItems((prev) => prev.map((i) => (i.id === target.id ? { ...i, status: "compressing", error: undefined, progress: 0, phase: "upload" } : i)));
            const ID_SEP = "__IDSEP__";
            const form = new FormData();
            form.append("files", target.file, `${target.id}${ID_SEP}${target.file.name}`);
            form.append("clientMap", JSON.stringify({ [target.file.name]: target.id }));
            const url = `${serverUrl}/api/compress?quality=${quality}`.replace(/\/\/api/, "/api");
            activeUploadsRef.current++;
            setBatching(true);
            try {
                const respJson: any = await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open("POST", url, true);
                    xhr.responseType = "json";
                    xhr.upload.onprogress = (e) => {
                        if (!e.lengthComputable) return;
                        const pct = e.total ? e.loaded / e.total : 0;
                        setItems((prev) => prev.map((p) => (p.id === target.id ? { ...p, progress: pct, phase: pct >= 1 ? "compress" : "upload" } : p)));
                    };
                    xhr.onerror = () => reject(new Error("网络错误"));
                    xhr.onload = () => {
                        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
                        else reject(new Error(`服务器响应 ${xhr.status}`));
                    };
                    xhr.send(form);
                });
                const dataItem = (respJson.items && respJson.items[0]) || undefined;
                if (!dataItem) throw new Error("响应无结果");
                if (dataItem.error) {
                    setItems((prev) => prev.map((i) => (i.id === target.id ? { ...i, status: "error", error: mapError(dataItem.error), progress: undefined, phase: "error" } : i)));
                    return;
                }
                setItems((prev) =>
                    prev.map((i) =>
                        i.id === target.id
                            ? {
                                  ...i,
                                  compressedSize: dataItem.compressedSize,
                                  downloadUrl: dataItem.downloadUrl,
                                  progress: 1,
                                  phase: "download"
                              }
                            : i
                    )
                );
                // 下载
                try {
                    const bResp = await fetch(`${serverUrl}${dataItem.downloadUrl}?t=${Date.now()}`);
                    if (!bResp.ok) throw new Error("下载失败");
                    const blob = await bResp.blob();
                    setItems((prev) =>
                        prev.map((i) => (i.id === target.id ? { ...i, compressedBlob: blob, lastQuality: i.quality, recompressing: false, status: "done", phase: "done", progress: 1 } : i))
                    );
                } catch (err: any) {
                    setItems((prev) => prev.map((i) => (i.id === target.id ? { ...i, status: "error", error: err.message, phase: "error" } : i)));
                }
            } catch (e: any) {
                showMsg(e.message || "上传失败");
                setItems((prev) => prev.map((i) => (i.id === target.id ? { ...i, status: "error", error: e.message, progress: undefined, phase: "error" } : i)));
            } finally {
                activeUploadsRef.current--;
                if (activeUploadsRef.current <= 0) setBatching(false);
            }
        },
        [serverUrl, showMsg]
    );

    // --- 处理新 pending 项批量发送 ---
    const processedRef = useRef<Set<string>>(new Set());
    // 监控待处理普通文件: 逐文件上传压缩
    useEffect(() => {
        const pendings = items.filter((i) => i.status === "pending" && !i.isChunked && !processedRef.current.has(i.id));
        if (!pendings.length) return;
        pendings.forEach((p) => {
            processedRef.current.add(p.id);
            sendSingleFile(p, p.quality);
        });
    }, [items, sendSingleFile]);

    // 监听需要分块的文件并启动上传
    useEffect(() => {
        const chunkTargets = items.filter((i) => i.isChunked && i.status === "compressing" && !i.chunkUploadId && !i.error && !i.canceled);
        if (!chunkTargets.length) return;
        chunkTargets.forEach((it) => {
            (async () => {
                try {
                    // 1. 计算 / 复用 hash
                    let hash = (it as any)._hash as string | undefined;
                    if (!hash) {
                        setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, phase: "hash" } : p)));
                        hash = await hashFileSHA256(it.file);
                        (it as any)._hash = hash;
                    }
                    // 2. 上传
                    const { item, uploadId, instant } = await chunkUploadFile(it.file, {
                        serverBase: serverUrl,
                        quality: it.quality,
                        hash,
                        signal: it.chunkAbort?.signal,
                        onProgress: (loaded, total) => {
                            setItems((prev) =>
                                prev.map((p) => {
                                    if (p.id !== it.id) return p;
                                    const doneUpload = loaded >= total;
                                    return {
                                        ...p,
                                        chunkProgress: loaded / total,
                                        phase: doneUpload ? "compress" : "upload",
                                        uploadPercent: Math.round((loaded / total) * 100)
                                    };
                                })
                            );
                        }
                    });
                    // 3. 秒传 - 直接下载
                    if (instant && item && item.downloadUrl) {
                        setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, phase: "download", uploadPercent: 100 } : p)));
                        const bResp = await fetch(`${serverUrl}${item.downloadUrl}`);
                        if (!bResp.ok) throw new Error("结果下载失败");
                        const blob = await bResp.blob();
                        setItems((prev) =>
                            prev.map((p) =>
                                p.id === it.id
                                    ? {
                                          ...p,
                                          compressedBlob: blob,
                                          compressedSize: item.compressedSize || blob.size,
                                          downloadUrl: item.downloadUrl,
                                          status: "done",
                                          lastQuality: p.quality,
                                          chunkUploadId: uploadId,
                                          chunkProgress: 1,
                                          phase: "done",
                                          uploadPercent: 100
                                      }
                                    : p
                            )
                        );
                        return; // 秒传处理完成后结束该任务
                    } else if (item?.error) {
                        setItems((prev) =>
                            prev.map((p) =>
                                p.id === it.id
                                    ? {
                                          ...p,
                                          status: "error",
                                          error: mapError(item.error),
                                          chunkUploadId: uploadId,
                                          phase: "error"
                                      }
                                    : p
                            )
                        );
                    }
                } catch (e: any) {
                    if (e.message === "已取消") {
                        setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, canceled: true, phase: "canceled" } : p)));
                    } else {
                        setItems((prev) =>
                            prev.map((p) =>
                                p.id === it.id
                                    ? {
                                          ...p,
                                          status: "error",
                                          error: e.message,
                                          chunkProgress: undefined,
                                          phase: "error"
                                      }
                                    : p
                            )
                        );
                    }
                }
            })();
        });
    }, [items, serverUrl]);

    // 取消分块上传
    const cancelChunk = (item: QueueItem) => {
        setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, canceled: true, phase: "canceled" } : p)));
        if (item.chunkAbort) {
            item.chunkAbort.abort();
        } else {
            const controller = new AbortController();
            controller.abort();
            setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, chunkAbort: controller, canceled: true, phase: "canceled" } : p)));
        }
    };

    // 恢复分块上传 (断点续传)
    const resumeChunk = (item: QueueItem) => {
        const controller = new AbortController();
        setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, canceled: false, chunkAbort: controller, status: "compressing", phase: "upload" } : p)));
    };

    // --- 删除/清空 ---
    const remove = (id: string) => {
        setItems((prev) => prev.filter((i) => i.id !== id));
        if (compare?.id === id) setCompare(null);
    };
    const clearAll = () => {
        setItems([]);
        setCompare(null);
    };

    // --- compare 同步 ---
    useEffect(() => {
        if (!compare && items.length) setCompare(items[0]);
        if (compare) {
            const fresh = items.find((i) => i.id === compare.id);
            if (fresh && fresh !== compare) setCompare(fresh);
        }
    }, [items, compare]);

    // --- 批量下载 ---
    const batchDownload = async () => {
        await downloadZip(items.filter((i) => i.compressedBlob && i.lastQuality !== 100));
    };

    // --- 应用质量（重新压缩） ---
    const applyQuality = () => {
        if (!compare) return;
        setItems((prev) => prev.map((p) => (p.id === compare.id ? { ...p, recompressing: true } : p)));
        const target = items.find((i) => i.id === compare.id);
        if (target) sendSingleFile({ ...target, recompressing: true }, target.quality);
    };

    return (
        <>
            <header>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1.5rem", flexWrap: "wrap" }}>
                    <h1 style={{ fontSize: "1.55rem", letterSpacing: ".5px", margin: 0 }}>图片压缩工具</h1>
                    <button onClick={toggleTheme} className="sm-btn" aria-label="切换主题" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        {theme === "dark" ? "🌙 深色" : "☀️ 浅色"}
                    </button>
                </div>
            </header>
            <div className="container">
                <UploadArea onFiles={addFiles} onRejectInfo={showMsg} />
                {message && (
                    <div
                        style={{
                            position: "fixed",
                            top: 12,
                            right: 12,
                            background: "#222",
                            color: "#fff",
                            padding: "8px 14px",
                            borderRadius: 6,
                            fontSize: ".75rem",
                            boxShadow: "0 4px 14px rgba(0,0,0,.3)"
                        }}
                    >
                        {message}
                    </div>
                )}
                <div className="toolbar">
                    <button onClick={batchDownload} disabled={!items.some((i) => i.compressedBlob) || batching}>
                        批量下载
                    </button>
                    <button className="danger" onClick={clearAll} disabled={!items.length}>
                        清空队列
                    </button>
                    {/* 取消全局压缩中提示，采用每文件进度+动画显示 */}
                    {items.length > 0 && (
                        <span style={{ fontSize: ".78rem", opacity: 0.75 }}>
                            合计原始: {formatBytes(items.reduce((a, b) => a + b.originalSize, 0))} / 压缩后: {formatBytes(items.reduce((a, b) => a + (b.compressedSize || 0), 0))}
                        </span>
                    )}
                </div>
                <div className="images-list grid" style={{ marginTop: "1rem" }}>
                    {items.map((it) => (
                        <ImageItem
                            key={it.id}
                            item={it}
                            selected={compare?.id === it.id}
                            batching={batching}
                            onSelect={(item) => setCompare(item)}
                            onRemove={remove}
                            onDownload={downloadSingle}
                            onRetry={(item) => {
                                setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "pending", error: undefined } : p)));
                                processedRef.current.delete(item.id);
                            }}
                            onCancelChunk={cancelChunk}
                            onResumeChunk={resumeChunk}
                        />
                    ))}
                    {/* 空列表时不再显示下方第二拖拽提示，避免视觉重复 */}
                </div>
                <div style={{ marginTop: "2.2rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
                    <div className="compare-area" style={{ width: "100%", display: "flex", justifyContent: "center", position: "relative" }}>
                        <div className="compare-stage" style={{ maxWidth: 900, width: "100%", position: "relative" }}>
                            {compare && compare.compressedBlob ? (
                                <>
                                    <CompareObject compare={compare} />
                                    <div className="quality-dock">
                                        <QualityPanel
                                            item={compare}
                                            onQuality={(v) => {
                                                if (!compare) return;
                                                setItems((prev) => prev.map((p) => (p.id === compare.id ? { ...p, quality: v } : p)));
                                                setCompare((c) => (c && c.id === compare.id ? { ...c, quality: v } : c));
                                            }}
                                            onApply={applyQuality}
                                            disabled={batching}
                                        />
                                    </div>
                                </>
                            ) : (
                                <div className="compare-wrapper empty" />
                            )}
                        </div>
                    </div>
                </div>
            </div>
            <footer style={{ textAlign: "center", padding: "2rem 0", fontSize: ".68rem", opacity: 0.55, lineHeight: 1.5 }}>
                隐私说明：图片仅在内存中即时处理，压缩完成即被清理，不会持久存储或用于模型训练。
            </footer>
        </>
    );
};

export default App;

// --- 独立组件: 管理 object URL 生命周期 ---
const CompareObject: React.FC<{ compare: QueueItem }> = ({ compare }) => {
    const [url, setUrl] = useState<string | undefined>();
    useEffect(() => {
        if (compare.compressedBlob) {
            const obj = URL.createObjectURL(compare.compressedBlob);
            setUrl(obj);
            return () => URL.revokeObjectURL(obj);
        }
        setUrl(undefined);
    }, [compare.compressedBlob, compare.id, compare.compressedSize]);
    return <CompareSlider original={compare.originalDataUrl} compressed={url} />;
};

export {};
