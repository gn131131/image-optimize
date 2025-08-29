import React, { useEffect, useState } from "react";
import CompareSlider from "./CompareSlider";
import { QueueItem } from "../types";

// 负责 compressedBlob 的 objectURL 生命周期
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

export default CompareObject;
