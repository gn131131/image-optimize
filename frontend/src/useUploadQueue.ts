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
    // 批量轮询相关
    const pollingIntervalRef = useRef<number | null>(null);
    const lastPollRef = useRef<number>(0);
    const ACTIVE_POLL_INTERVAL = 700; // ms 节流
    // 最新 items 引用，避免轮询闭包过期
    const itemsRef = useRef<QueueItem[]>(items);
    useEffect(() => {
        itemsRef.current = items;
    }, [items]);

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
            console.log("[recompress:start]", { id: target.id, quality, prevStatus: target.status });
            setItems((prev) => {
                const next: QueueItem[] = prev.map(
                    (i): QueueItem =>
                        i.id === target.id
                            ? ({
                                  ...i,
                                  status: "compressing",
                                  error: undefined,
                                  progress: 0,
                                  compressionProgress: 0,
                                  phase: "upload",
                                  recompressing: i.compressedBlob ? true : i.recompressing,
                                  _fetched: false,
                                  _fetching: false
                              } as any)
                            : i
                );
                itemsRef.current = next;
                return next;
            });
            const ID_SEP = "__IDSEP__";
            const form = new FormData();
            form.append("files", target.file, `${target.id}${ID_SEP}${target.file.name}`);
            form.append("clientMap", JSON.stringify({ [target.file.name]: target.id }));
            const url = `${serverUrl}/api/compress?quality=${quality}&progress=1`.replace(/\/\/api/, "/api");
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
                        const enteredCompress = pct >= 1;
                        console.log("[upload:progress]", target.id, pct);
                        setItems((prev) => {
                            const next: QueueItem[] = prev.map((p): QueueItem => (p.id === target.id ? ({ ...p, progress: pct, phase: enteredCompress ? "compress" : "upload" } as QueueItem) : p));
                            itemsRef.current = next;
                            return next;
                        });
                    };
                    xhr.onerror = () => reject(new Error("网络错误"));
                    xhr.onload = () => {
                        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
                        else reject(new Error(`服务器响应 ${xhr.status}`));
                    };
                    xhr.send(form);
                });
                // 异步模式响应: { async:true, items:[{id,jobId,...}] }
                if (!respJson || !respJson.items || !respJson.items.length) throw new Error("响应无结果");
                const jobInfo = respJson.items.find((it: any) => it.id === target.id) || respJson.items[0];
                if (!jobInfo || !jobInfo.jobId) throw new Error("缺少 jobId");
                console.log("[job:assigned]", target.id, jobInfo.jobId);
                setItems((prev) => {
                    const next: QueueItem[] = prev.map((i): QueueItem => (i.id === target.id ? ({ ...i, phase: "compress", compressionProgress: 0, jobId: jobInfo.jobId } as QueueItem) : i));
                    itemsRef.current = next;
                    return next;
                });
                // 若轮询未启动则手动触发一次
                if (!pollingIntervalRef.current) {
                    const manualTick = () => {
                        lastPollRef.current = 0; // 允许立刻轮询
                    };
                    manualTick();
                }
            } catch (e: any) {
                console.log("[upload:error]", target.id, e);
                showMsg(e.message || "上传失败");
                setItems((prev) => prev.map((i) => (i.id === target.id ? { ...i, status: "error", error: e.message, progress: undefined, phase: "error" } : i)));
            } finally {
                activeUploadsRef.current--;
                if (activeUploadsRef.current <= 0) setBatching(false);
                console.log("[upload:done]", target.id);
            }
        },
        [serverUrl, showMsg]
    );

    // 批量轮询 job 进度
    useEffect(() => {
        const phaseMap: Record<string, number> = { queued: 0, decoding: 0.05, resizing: 0.25, encoding: 0.6, finalizing: 0.9, done: 1 };
        const tick = async () => {
            const now = Date.now();
            if (now - lastPollRef.current < ACTIVE_POLL_INTERVAL) return;
            lastPollRef.current = now;
            const snapshot = itemsRef.current;
            const activeJobs = snapshot.filter((i) => i.jobId && i.phase === "compress");
            if (!activeJobs.length) {
                if (pollingIntervalRef.current) {
                    clearInterval(pollingIntervalRef.current);
                    pollingIntervalRef.current = null;
                }
                return;
            }
            try {
                const ids = Array.from(new Set(activeJobs.map((j) => j.jobId!))).join(",");
                if (!ids) return;
                console.log("[poll] ids=", ids);
                const resp = await fetch(`${serverUrl}/api/jobs?ids=${encodeURIComponent(ids)}`);
                if (!resp.ok) return;
                const data = await resp.json();
                const list: any[] = data.items || [];
                console.log("[poll:resp]", list);
                setItems((prev) =>
                    prev.map((it) => {
                        if (!it.jobId) return it;
                        const rec = list.find((r) => r.jobId === it.jobId);
                        if (!rec) return it;
                        if (rec.error) return { ...it, status: "error", error: mapError(rec.error), phase: "error", compressionProgress: 1, jobId: undefined, recompressing: false };
                        const phase = rec.phase as string;
                        if (phase === "done" && rec.downloadUrl) {
                            console.log("[job:done]", it.id, rec.downloadUrl);
                            return {
                                ...it,
                                phase: "download",
                                compressionProgress: 1,
                                compressedSize: rec.compressedSize,
                                downloadUrl: rec.downloadUrl,
                                jobId: undefined
                            };
                        }
                        const prog = typeof rec.progress === "number" ? rec.progress : phaseMap[phase] ?? 0;
                        console.log("[job:progress]", it.id, phase, prog);
                        return { ...it, phase: phase === "finalizing" ? "compress" : "compress", compressionProgress: prog };
                    })
                );
            } catch {}
        };
        if (!pollingIntervalRef.current) {
            // 判断当前是否需要开启
            const initialActive = itemsRef.current.some((i) => i.jobId && i.phase === "compress");
            if (initialActive) {
                pollingIntervalRef.current = window.setInterval(tick, ACTIVE_POLL_INTERVAL);
                tick();
            }
        }
        return () => {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
            }
        };
    }, [serverUrl, items]);

    // 下载阶段
    useEffect(() => {
        // 之前条件包含 !i.compressedBlob，导致重新压缩(recompressing=true)时保留旧结果无法触发二次下载
        // 调整为：只要进入 download 阶段且未标记 _fetched，就拉取新结果；允许已存在旧 compressedBlob (用于对比展示)
        const pending = items.filter((i) => i.phase === "download" && i.downloadUrl && !(i as any)._fetched && (!i.compressedBlob || i.recompressing));
        if (!pending.length) return;
        pending.forEach(async (it) => {
            console.log("[download:start]", it.id, it.downloadUrl);
            try {
                (it as any)._fetched = true;
                (it as any)._fetching = true;
                const resp = await fetch(`${serverUrl}${it.downloadUrl}`);
                if (!resp.ok) throw new Error("下载失败");
                const blob = await resp.blob();
                console.log("[download:ok]", it.id, blob.size);
                setItems((prev) =>
                    prev.map((p) => {
                        if (p.id !== it.id) return p;
                        return {
                            ...p,
                            compressedBlob: blob,
                            status: "done",
                            phase: "done",
                            lastQuality: p.quality,
                            progress: 1,
                            compressionProgress: 1,
                            recompressing: false
                        };
                    })
                );
            } catch (e: any) {
                console.log("[download:error]", it.id, e);
                setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, status: "error", error: e.message, phase: "error", recompressing: false } : p)));
            }
        });
    }, [items, serverUrl]);

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
                    const {
                        item,
                        uploadId,
                        instant,
                        async: asyncFlag,
                        jobId: asyncJobId
                    } = await chunkUploadFile(it.file, {
                        serverBase: serverUrl,
                        quality: it.quality,
                        hash,
                        clientId: it.id,
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
                    } else if (asyncFlag && asyncJobId) {
                        setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, phase: "compress", jobId: asyncJobId, compressionProgress: 0 } : p)));
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
