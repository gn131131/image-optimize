import React from "react";
import { useDropzone } from "react-dropzone";

interface Props {
    onFiles: (files: File[]) => void;
    disabled?: boolean;
    onRejectInfo?: (msg: string) => void; // 反馈被前端过滤的原因
}

// 扩展常见 jpeg 变体 & 大写，后端仍限制 mime
const ACCEPT = {
    "image/jpeg": [".jpg", ".jpeg", ".jpe", ".jfif", ".pjpeg", ".pjp"],
    "image/png": [".png"],
    "image/webp": [".webp"]
};

const MAX_SINGLE = 50 * 1024 * 1024; // 与后端对齐
const MAX_TOTAL = 200 * 1024 * 1024;
const MAX_FILES = 30;

const UploadArea: React.FC<Props> = ({ onFiles, disabled, onRejectInfo }) => {
    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        accept: ACCEPT,
        disabled,
        multiple: true,
        onDrop: (accepted, fileRejections, event) => {
            const rawList = [...accepted];
            const acceptedFiltered: File[] = [];
            let total = 0;
            for (const f of rawList) {
                if (f.size > MAX_SINGLE) {
                    onRejectInfo?.(`文件 ${f.name} 超过单文件限制 50MB，已跳过`);
                    continue;
                }
                if (acceptedFiltered.length >= MAX_FILES) {
                    onRejectInfo?.(`超过最大文件数 ${MAX_FILES}，剩余忽略`);
                    break;
                }
                if (total + f.size > MAX_TOTAL) {
                    onRejectInfo?.(`总大小超过 ${Math.round(MAX_TOTAL / 1024 / 1024)}MB，后续忽略`);
                    break;
                }
                acceptedFiltered.push(f);
                total += f.size;
            }
            if (acceptedFiltered.length) onFiles(acceptedFiltered);
            if (!acceptedFiltered.length && !fileRejections.length) {
                onRejectInfo?.("没有文件被添加（类型或大小限制）");
            }
        }
    });
    return (
        <div {...getRootProps({ className: "upload-area" + (isDragActive ? " drag" : "") })}>
            <input {...getInputProps()} />
            <p style={{ fontSize: "0.95rem", margin: "0 0 .4rem" }}>拖拽或点击添加图片（支持多张）</p>
            <div style={{ fontSize: "0.7rem", lineHeight: 1.45, opacity: 0.78 }}>
                <div>格式: JPG / PNG / WebP</div>
                <div>单文件 ≤ 50MB · 总大小 ≤ 200MB · 最多 30 张</div>
                <div style={{ opacity: 0.65 }}>即时压缩处理，不做持久存储</div>
            </div>
        </div>
    );
};

export default UploadArea;
