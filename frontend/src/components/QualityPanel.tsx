import React from "react";
import { QueueItem } from "../types";

interface Props {
    item: QueueItem | null;
    onQuality: (q: number) => void;
    onApply: () => void;
    disabled?: boolean;
}

// 垂直质量控制面板（固定在右侧）
const QualityPanel: React.FC<Props> = ({ item, onQuality, onApply, disabled }) => {
    if (!item) return null;
    return (
        <div className="quality-panel" role="group" aria-label="质量设置">
            <div className="qp-header">质量</div>
            <div className="qp-value" aria-live="polite">
                {item.quality}
                <span className="qp-unit">/100</span>
            </div>
            <div className="qp-slider-wrap">
                {/* 旋转后的水平 input 以实现可用性（原生垂直在部分浏览器不一致） */}
                <input
                    type="range"
                    min={1}
                    max={100}
                    value={item.quality}
                    onChange={(e) => onQuality(Number(e.target.value))}
                    className="quality-range-vertical"
                    aria-valuemin={1}
                    aria-valuemax={100}
                    aria-valuenow={item.quality}
                    aria-label="压缩质量"
                />
            </div>
            <button
                className="primary sm-btn qp-apply"
                onClick={onApply}
                disabled={disabled || item.recompressing || item.quality === item.lastQuality}
                aria-disabled={disabled || item.recompressing || item.quality === item.lastQuality}
            >
                应用
            </button>
            {item.lastQuality !== item.quality && !item.recompressing && (
                <div className="qp-hint" aria-hidden>
                    变化: {item.lastQuality}→{item.quality}
                </div>
            )}
            {item.recompressing && (
                <div className="qp-hint" style={{ color: "var(--accent)" }}>
                    处理中...
                </div>
            )}
        </div>
    );
};

export default QualityPanel;
