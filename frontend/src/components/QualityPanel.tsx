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
                title={item.recompressing ? "处理中" : item.quality === item.lastQuality ? "当前质量已应用" : "应用新质量"}
            >
                <span className="qp-ic" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 8.2 6.8 12 13 4" />
                    </svg>
                </span>
                <span>应用</span>
            </button>
        </div>
    );
};

export default QualityPanel;
