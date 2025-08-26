import { LRUCache } from "./lru.js";
import Redis from "ioredis";

export interface CacheEntry {
    format: string;
    data: Buffer;
    w?: number;
    h?: number;
    quality: number;
    ts: number;
}

export interface UnifiedCache {
    get(key: string): Promise<CacheEntry | undefined> | CacheEntry | undefined;
    set(key: string, val: CacheEntry): Promise<void> | void;
    size?(): number | undefined;
}

export function createCache(): { cache: UnifiedCache; kind: string } {
    if (process.env.USE_REDIS === "1" && process.env.REDIS_URL) {
        const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, enableReadyCheck: false });
        const cache: UnifiedCache = {
            async get(key) {
                const buf = await redis.getBuffer(key);
                if (!buf) return undefined;
                const nl = buf.indexOf(10);
                if (nl === -1) return undefined;
                const meta = JSON.parse(buf.subarray(0, nl).toString()) as any;
                const data = buf.subarray(nl + 1);
                return { ...meta, data } as CacheEntry;
            },
            async set(key, val) {
                const meta = { format: val.format, w: val.w, h: val.h, quality: val.quality, ts: val.ts };
                const payload = Buffer.concat([Buffer.from(JSON.stringify(meta) + "\n"), val.data]);
                await redis.set(key, payload, "EX", 6 * 3600);
            },
            size() { return undefined; }
        };
        return { cache, kind: "redis" };
    }
    const lru = new LRUCache<CacheEntry>({ max: parseInt(process.env.CACHE_MAX_ENTRIES || "600", 10) });
    return {
        kind: "memory",
        cache: {
            get: (k) => lru.get(k),
            set: (k, v) => lru.set(k, v),
            size: () => lru.size
        }
    };
}
