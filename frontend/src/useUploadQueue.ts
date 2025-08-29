import { useCallback, useEffect, useRef, useState } from "react";
import { QueueItem } from "./types";
import { readFileAsDataUrl } from "./utils/compress";
import { generateId } from "./utils/uuid";
import { chunkUploadFile, hashFileSHA256 } from "./utils/chunkUpload";
import { ALLOWED_MIME, LIMITS, mapError } from "./constants";

export function useServerBase() {
    const [serverUrl] = useState<string>(() => {
        const raw = (import.meta as any).env?.VITE_API_BASE as string | undefined;
        if (raw && raw.trim()) return raw.replace(/\/$/, "");
        if (typeof window !== "undefined" && window.location.hostname !== "localhost") return "";
        return "http://localhost:3001";
    });
    return serverUrl;
}

export interface UseUploadQueueResult {
    items: QueueItem[];
    setItems: React.Dispatch<React.SetStateAction<QueueItem[]>>;
    addFiles: (files: File[]) => Promise<void>;
    remove: (id: string) => void;
    clearAll: () => void;
    sendSingleFile: (target: QueueItem, quality: number) => Promise<void>;
    cancelChunk: (item: QueueItem) => void;
    resumeChunk: (item: QueueItem) => void;
    batching: boolean;
}

export function useUploadQueue(showMsg: (m: string) => void): UseUploadQueueResult {
    const serverUrl = useServerBase();
    const [items, setItems] = useState<QueueItem[]>([]);
    const [batching, setBatching] = useState(false);

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
                    let dq = 70;
                    if (f.type.includes("jpeg")) dq = 85;
                    else if (f.type.includes("png")) dq = 85;
                    else if (f.type.includes("webp")) dq = 80;
                    const isChunked = f.size > LIMITS.MAX_SINGLE;
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
            if (mapped.length) setItems((prev) => [...prev, ...mapped]);
        },
        [items]
    );

    // 单文件上传
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
                setItems((prev) => prev.map((i) => (i.id === target.id ? { ...i, compressedSize: dataItem.compressedSize, downloadUrl: dataItem.downloadUrl, progress: 1, phase: "download" } : i)));
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

    // pending 普通文件上传
    const processedRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        const pendings = items.filter((i) => i.status === "pending" && !i.isChunked && !processedRef.current.has(i.id));
        if (!pendings.length) return;
        pendings.forEach((p) => {
            processedRef.current.add(p.id);
            sendSingleFile(p, p.quality);
        });
    }, [items, sendSingleFile]);

    // 分块上传
    useEffect(() => {
        const chunkTargets = items.filter((i) => i.isChunked && i.status === "compressing" && !i.chunkUploadId && !i.error && !i.canceled);
        if (!chunkTargets.length) return;
        chunkTargets.forEach((it) => {
            (async () => {
                try {
                    let hash = (it as any)._hash as string | undefined;
                    if (!hash) {
                        setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, phase: "hash" } : p)));
                        hash = await hashFileSHA256(it.file);
                        (it as any)._hash = hash;
                    }
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
                                    return { ...p, chunkProgress: loaded / total, phase: doneUpload ? "compress" : "upload", uploadPercent: Math.round((loaded / total) * 100) };
                                })
                            );
                        }
                    });
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
                        return;
                    } else if (item?.error) {
                        setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, status: "error", error: mapError(item.error), chunkUploadId: uploadId, phase: "error" } : p)));
                    }
                } catch (e: any) {
                    if (e.message === "已取消") setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, canceled: true, phase: "canceled" } : p)));
                    else setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, status: "error", error: e.message, chunkProgress: undefined, phase: "error" } : p)));
                }
            })();
        });
    }, [items, serverUrl]);

    const cancelChunk = (item: QueueItem) => {
        setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, canceled: true, phase: "canceled" } : p)));
        if (item.chunkAbort) item.chunkAbort.abort();
        else {
            const controller = new AbortController();
            controller.abort();
            setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, chunkAbort: controller, canceled: true, phase: "canceled" } : p)));
        }
    };
    const resumeChunk = (item: QueueItem) => {
        const controller = new AbortController();
        setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, canceled: false, chunkAbort: controller, status: "compressing", phase: "upload" } : p)));
    };

    const remove = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id));
    const clearAll = () => setItems([]);

    return { items, setItems, addFiles, remove, clearAll, sendSingleFile, cancelChunk, resumeChunk, batching };
}
