import JSZip from "jszip";
import { saveAs } from "file-saver";
import { QueueItem } from "../types";

export async function downloadSingle(item: QueueItem) {
    if (!item.compressedBlob) return;
    const ext = guessExt(item.compressedBlob.type) || "jpg";
    saveAs(item.compressedBlob, baseName(item.file.name) + `-q.${ext}`);
}

export async function downloadZip(items: QueueItem[]) {
    const zip = new JSZip();
    items
        .filter((i) => i.compressedBlob)
        .forEach((i) => {
            const ext = guessExt(i.compressedBlob!.type) || "jpg";
            zip.file(baseName(i.file.name) + `-q.${ext}`, i.compressedBlob!);
        });
    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, `compressed-${Date.now()}.zip`);
}

function baseName(name: string) {
    return name.replace(/\.[^.]+$/, "");
}
function guessExt(mime: string) {
    if (mime.includes("jpeg")) return "jpg";
    if (mime.includes("png")) return "png";
    if (mime.includes("webp")) return "webp";
    return "";
}
