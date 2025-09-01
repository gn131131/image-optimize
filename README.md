# Image Optimize（全部由 GPT-5 生成的图片压缩网站）

> 本项目的代码、架构说明与 README 文案均通过 GPT 辅助迭代生成与优化（人工仅做少量运行 / 测试校验）。目标是一个现代化、支持进度与大文件分块的在线图片压缩体验。

## 特性概览

前端体验：
- 拖拽 / 点击 多选导入（JPG / PNG / WebP）
- 水平缩略图走马灯（轮播）+ 实时异步进度环（hash / upload / compress / download 映射到 0–100%）
- 压缩完成后缩略图中央显示“大号压缩率百分比”叠层；聚焦 / Hover 自动淡出，显示操作按钮
- 单图下载 / 删除（下载与删除按钮 hover 无位移动画，响应即时）
- 防重复下载（同一文件仅获取一次二进制）
- 质量调节面板（垂直滑块 1–100）+ 再压缩（仅对选中项生效，避免无谓批量开销）
- 原图 vs 压缩图 对比视图：支持滑块分割、平移 (pan)、滚轮缩放 (zoom)、双击重置、键盘左右键细调分割条
- 异步 Job 轮询（批量 ids 合并请求 `/api/jobs` 减少网络抖动）
- 分块上传（超大文件 / 断点续传准备逻辑）
- 预留“秒传”机制（hash + quality 命中缓存即跳过重新编码）
- 深色 / 浅色主题自动适配（通过 data-theme）
- 键盘可访问性：缩略图 Enter/Space 选中、对比滑块 Arrow 控制

后端服务：
- Node.js + Express + Sharp 进行有损 / 无损（根据格式）压缩
- 单请求批量与分块上传双路径：`/api/compress` (同步 / 异步进度版)、`/api/upload/*` 分块协议
- 统一内存结果缓存（TTL 10 分钟）+ LRU/TTL 结合的字节与条目数量淘汰
- 自实现 Promise 并发限速器（避免一次性 CPU 饱和）
- 进度 Job 状态机：queued → decoding → resizing → encoding → finalizing → done/error
- 分块会话：支持超大文件，内存占用与会话 TTL 清理
- 失败场景覆盖：尺寸过大 / 结果缓存溢出 / 编码超时 / 类型不支持 / 单块或会话不完整

资源与限制：
- 单文件 ≤ 50MB（常规批量）
- 单次最多 30 文件，总体 ≤ 200MB
- 分块模式单文件上限（可配置，默认 800MB）
- 结果缓存默认：≤300MB 或 ≤500 条，超出触发逐出

## 目录结构（简）

```
frontend/
	src/components  # UploadArea, ThumbCarousel, QualityPanel, CompareSlider 等
	src/utils       # 分块上传、下载、压缩前端辅助
backend/
	src/server.ts   # 路由、压缩、进度 Job、分块上传、缓存逻辑
	src/types/dto.ts
```

## 前端职责
1. 文件选择 / 预览 DataURL
2. 状态管理（pending / compressing / done / error + 细分 phase）
3. 合并轮询批量进度，更新缩略图进度环
4. 质量调节与再次压缩（避免无差异质量重复发起）
5. 分块上传客户端侧切片、进度汇总（逻辑在 utils 中，已实现核心）
6. 对比查看 & 交互（缩放 / 平移 / 分割）
7. 下载（单文件 / 未来可扩展 ZIP 批量）

## 后端职责
1. 表单批量压缩接口 `/api/compress`：同步模式或 `?progress=1` 异步模式
2. 进度查询：`/api/job/:id` 与 `/api/jobs?ids=...` 批量
3. 分块上传：init → chunk → complete → （可选 progress job）
4. 质量与像素阈值控制（超大像素自动缩放至上限内）
5. 结果缓存 + 淘汰策略 + 秒传索引 (hash+quality)
6. 错误与尺寸、格式校验、超时防护

## 运行方式

### 前端开发
```powershell
cd frontend
npm install
npm run dev
```
默认访问: http://localhost:5173

### 后端开发
```powershell
cd backend
npm install
npm run dev
```
默认监听: http://localhost:3001 （健康检查 /health）

### Docker / docker-compose

```powershell
docker compose build
docker compose up -d
```
前端默认暴露 18080，可通过 `FRONTEND_PORT` 环境变量调整：
```powershell
$env:FRONTEND_PORT=30080; docker compose up -d
```
拉取远程已构建镜像：
```powershell
docker compose pull
docker compose up -d
```

单独调试构建：
```powershell
docker build -f Dockerfile.backend -t image-opt-backend:dev .
docker build -f Dockerfile.frontend -t image-opt-frontend:dev .
```

### 停止
```powershell
docker compose down
```

## 已实现 / 状态
- ✅ 多文件导入 / 预览
- ✅ 异步压缩 Job & 合并轮询
- ✅ 缩略图进度环 + 阶段映射
- ✅ 中心压缩率 Overlay（Hover/选中淡出）
- ✅ 单图删除 / 下载
- ✅ 分块上传核心后端 & 会话清理
- ✅ 质量修改与重新压缩
- ✅ 对比视图（Slider + Pan + Zoom）
- ✅ 主题（dark / light）
- ✅ 结果缓存 + 淘汰策略
- ✅ 防重复下载
- ⚠️ 秒传索引（已建索引结构，复用需前端提供 hash 流程 — 可扩展）

## 计划 / 可扩展
- 批量 ZIP 下载（前端聚合 + service worker / 后端打包）
- EXIF 处理（保留 / 去除）
- AVIF / JXL 等更多编解码（可接入 WASM）
- PWA / 离线缓存
- 缩略图虚拟化（上千文件性能提升）
- 更丰富的可访问性 (ARIA / 键盘导航网格)
- 服务端持久化（Redis / 对象存储）+ CDN
- Hash 生成提前在 Web Worker 中并行
- 上传速度自适应分块调节 / 重传策略

## 许可

MIT

---
如果你想验证或再生成功能/代码，可直接在当前仓库基础上继续通过 GPT 对话追加需求；本 README 会根据演进继续更新。

## 运行

### 前端开发
```powershell
cd frontend
npm install
npm run dev
```
访问输出地址（默认 http://localhost:5173）。

### 后端
```powershell
cd backend
npm install
npm run dev
```
默认监听 http://localhost:3001。

### Docker / docker-compose

#### 开发（本地自行构建镜像）
```powershell
docker compose build
docker compose up -d
```
默认前端映射端口已改为 18080，可通过环境变量覆盖：
```powershell
$env:FRONTEND_PORT=30080; docker compose up -d
```
访问: http://localhost:18080 (或自定义端口)；健康检查 http://localhost:3001/health

#### 生产（CI 已推送镜像）
当前 `docker-compose.yml` 直接引用私有仓库 `docker.pumpking.life` 镜像：
```yaml
image: docker.pumpking.life/image-opt-backend:latest
image: docker.pumpking.life/image-opt-frontend:latest
```
部署步骤：
```bash
docker login docker.pumpking.life
docker compose pull
TAG=latest FRONTEND_PORT=18080 docker compose up -d
```
如需部署指定 commit：将 CI 生成的 `sha-xxxx` 标签替换 `TAG`。

#### 停止与清理
```powershell
docker compose down
```

#### 单独构建（调试用）
```powershell
docker build -f Dockerfile.backend -t image-opt-backend:dev .
docker build -f Dockerfile.frontend -t image-opt-frontend:dev .
```

## TODO / 后续可扩展

- （可选）恢复/并存纯前端压缩模式（用于隐私场景）
- Web Worker + OffscreenCanvas 并行前端预览生成
- 支持保留 EXIF / 去除 EXIF 选项
- 自适应格式决策（例如 WebP / AVIF）
- 累计节省体积统计 UI
- 拖拽重新排序
- 暗色主题 / 响应式适配
- PWA / 离线支持
- Service Worker 作为压缩任务调度
- 集成 wasm codec (squoosh: mozjpeg, webp, avif, jxl)
- 分块/流式上传与结果异步轮询
- 结果持久化 + CDN 缓存

## 代码结构

frontend/
- src/components 上传区、图片条目、对比滑块
- src/utils 前端压缩与下载工具

backend/
- src/server.ts 主要业务路由（/api/compress, /api/download/:id）
- src/types/dto.ts 接口类型定义

## 许可

MIT
