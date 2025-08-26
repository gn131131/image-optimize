import React from "react";
import { useDropzone } from "react-dropzone";

interface Props {
    onFiles: (files: File[]) => void;
    disabled?: boolean;
}

const ACCEPT = { "image/*": [".jpg", ".jpeg", ".png", ".webp"] };

const UploadArea: React.FC<Props> = ({ onFiles, disabled }) => {
    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        accept: ACCEPT,
        disabled,
        multiple: true,
        onDrop: (accepted) => {
            if (accepted.length) onFiles(accepted);
        }
    });
    return (
        <div {...getRootProps({ className: "upload-area" + (isDragActive ? " drag" : "") })}>
            <input {...getInputProps()} />
            <p>拖拽图片到此或点击选择 (支持多张)</p>
            <p style={{ fontSize: "0.8rem", opacity: 0.7 }}>支持: JPG / PNG / WebP</p>
        </div>
    );
};

export default UploadArea;
