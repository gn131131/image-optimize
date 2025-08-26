import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { optimizeImageBuffer } from "../services/optimizeService.js";

async function createSampleBuffer() {
    const w = 16,
        h = 16;
    const raw = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 3;
            raw[i] = x * 16;
            raw[i + 1] = y * 16;
            raw[i + 2] = 128;
        }
    }
    return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
        .png()
        .toBuffer();
}

describe("optimizeImageBuffer", () => {
    it("auto format returns data", async () => {
        const buf = await createSampleBuffer();
        const res = await optimizeImageBuffer(buf, {
            quality: 70,
            format: "auto",
            mimetype: "image/png",
            width: undefined,
            height: undefined
        });
        expect(res.data.length).toBeGreaterThan(10);
    });
});
