# Image Optimize Web App

一个类似 imagecompressor.com 的在线图片压缩站点雏形。目前版本采用 服务器端 (Node + Sharp) 压缩，前端通过异步获取二进制结果（不再使用 Base64 传输以减少带宽与内存开销）。早期 README 描述的“完全前端压缩”模式已迁移为可选方向（可在后续分支恢复）。

## 已实现功能 (MVP)

- 拖拽 / 点击 选择图片 (多选)
- 队列展示：原始尺寸、压缩后尺寸、压缩率
- 全局质量滑块（1-100）支持自动重新批量压缩（带 debounce）
- 单张删除、清空全部
- 单张下载压缩结果
- 批量打包 ZIP 下载
- 侧边对比（原图 vs 压缩图）滑块组件
- 支持 JPEG / PNG / WebP 输入（输出保持原格式）
- 结果通过唯一 ID + 下载端点二次异步获取，避免 Base64 膨胀
- 后端并发限制与大小/数量限制：单文件 ≤50MB，单次 ≤30 文件，总体 ≤200MB

## 架构说明

前端 (Vite + React) 负责：
1. 文件选择/拖拽、本地预览 (DataURL)
2. 质量调节 & 去抖后触发批量重压缩
3. 队列状态管理（pending / compressing / done / error）
4. 按需下载单个或批量 ZIP

后端 (Express + Sharp) 负责：
1. 限制校验（数量 / 单个大小 / 总体积 / MIME 白名单）
2. 受控并发压缩（自实现 limiter，默认并行 4）
3. 每个文件生成唯一 ID，压缩结果缓存在内存中（TTL 10 分钟）
4. 返回结构化 JSON（无 base64），包含 `downloadUrl` 供前端后续获取二进制
5. 临时下载端点 `/api/download/:id` 输出二进制数据

后续可替换内存缓存为 Redis / S3 等持久化方案。

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
