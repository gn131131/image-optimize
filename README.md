# Image Optimize Web App

一个类似 imagecompressor.com 的在线图片压缩站点雏形（前端本地压缩，无需将原图上传至服务器）。

## 已实现功能 (MVP)

- 拖拽 / 点击 选择图片 (多选)
- 队列展示：原始尺寸、压缩后尺寸、压缩率
- 全局质量滑块（1-100）实时重新压缩
- 单张删除、清空全部
- 单张下载压缩结果
- 批量打包 ZIP 下载
- 侧边对比（原图 vs 压缩图）滑块组件
- 支持 JPEG / PNG / WebP 输入（输出默认 JPEG，可切换为原格式或 WebP —— 预留）

## 架构说明

当前压缩逻辑完全在浏览器端通过 Canvas / OffscreenCanvas 完成，避免大文件上传的带宽与隐私问题。后端仅占位（Express）便于未来扩展（例如：
1. 更高级的有损/无损算法（mozjpeg / oxipng / wasm codecs）
2. 大文件 / 批量异步任务
3. 用户配额 / 登录 / 统计
）。

## 运行

### 前端开发
```powershell
cd frontend
npm install
npm run dev
```
访问输出地址（默认 http://localhost:5173）。

### 后端（可选占位）
```powershell
cd backend
npm install
npm run dev
```
默认监听 http://localhost:3001。

### Docker / docker-compose

构建并启动（前端静态资源 + 后端 API）:
```powershell
docker compose build
docker compose up -d
```
访问: http://localhost:8080 (前端) ；后端健康检查 http://localhost:3001/health

停止与清理:
```powershell
docker compose down
```

仅构建镜像：
```powershell
docker build -f Dockerfile.backend -t image-opt-backend .
docker build -f Dockerfile.frontend -t image-opt-frontend .
```

## TODO / 后续可扩展

- Web Worker + OffscreenCanvas 并行压缩，避免主线程卡顿
- 支持保留 EXIF / 去除 EXIF 选项
- 自适应格式决策（例如 WebP / AVIF）
- 累计节省体积统计 UI
- 拖拽重新排序
- 暗色主题 / 响应式适配
- PWA / 离线支持
- Service Worker 作为压缩任务调度
- 集成 wasm codec (squoosh codecs: mozjpeg, webp, avif, jxl)

## 代码结构

frontend/
- src/components 上传区、图片条目、对比滑块
- src/utils 前端压缩与下载工具

backend/ (暂时最小)
- src/server.ts Express 占位 + CORS

## 许可

MIT
