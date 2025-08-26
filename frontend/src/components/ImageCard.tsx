import React from "react";
import { formatSize } from "../utils/format";

interface Props {
    img: {
        originalName: string;
        originalSize: number;
        optimizedSize: number;
        savedBytes: number;
        ratio: number;
        downloadName: string;
        base64: string;
    };
}

export const ImageCard: React.FC<Props> = ({ img }) => {
    return (
        <div style={{ display: "flex", gap: 24, marginBottom: 32, flexWrap: "wrap" }}>
            <div>
                <img src={img.base64} style={{ maxWidth: 300, border: "1px solid #333" }} />
            </div>
            <div style={{ minWidth: 260 }}>
                <p>{img.originalName}</p>
                <p>
                    原始: {formatSize(img.originalSize)} → 优化: {formatSize(img.optimizedSize)}
                </p>
                <p>
                    压缩率: {img.ratio}% 节省 {formatSize(img.savedBytes)}
                </p>
                <a href={img.base64} download={img.downloadName}>
                    下载
                </a>
            </div>
        </div>
    );
};
