import React, { useState } from "react";

interface Props {
    onFiles: (files: File[]) => void;
}

export const DropZone: React.FC<Props> = ({ onFiles }: Props) => {
    const [dragging, setDragging] = useState(false);
    return (
        <div
            onDragOver={(e: React.DragEvent<HTMLDivElement>) => {
                e.preventDefault();
                if (!dragging) setDragging(true);
            }}
            onDragLeave={(e: React.DragEvent<HTMLDivElement>) => {
                if (e.currentTarget === e.target) setDragging(false);
            }}
            onDrop={(e: React.DragEvent<HTMLDivElement>) => {
                e.preventDefault();
                setDragging(false);
                const all = Array.from(e.dataTransfer.files as FileList) as File[];
                const fs = all.filter((f) => f.type.startsWith("image/"));
                onFiles(fs);
            }}
            style={{ border: `2px dashed ${dragging ? "#58a6ff" : "#444"}`, padding: 40, textAlign: "center", borderRadius: 12, background: dragging ? "#1e2530" : "#161b22", transition: "all .15s" }}
        >
            <p>{dragging ? "释放以上传" : "拖拽图片到这里 或"}</p>
            <input
                type="file"
                multiple
                accept="image/*"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const all = Array.from((e.target.files || []) as FileList) as File[];
                    const list = all.filter((f) => f.type.startsWith("image/"));
                    onFiles(list);
                }}
            />
        </div>
    );
};
