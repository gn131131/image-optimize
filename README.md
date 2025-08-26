# 在线图片压缩站点 (MVP)

## 功能目标 (第一阶段)
- 批量上传 (拖拽 + 选择)
- 指定质量、输出格式(auto/webp/avif/jpeg/png)
- 返回压缩后预览与节省大小
- 可下载单个文件

## 本地开发
### 后端
```powershell
cd backend
npm install
npm run dev
```
默认端口: 4000

### 前端
```powershell
cd ../frontend
npm install
npm run dev
```
访问: http://localhost:5173 (Vite 默认端口)

如需修改 API 地址，在前端启动前设置环境变量：
```powershell
$env:VITE_API_BASE='http://localhost:4000'
npm run dev
```

## 下一步计划 (后续可迭代)
- 前端多图对比前后大小图示
- 下载全部 -> ZIP
- 任务进度/并行控制 + Web Worker
- 服务端支持自适应选择最优格式 (AVIF/WebP/JPEG fallback)
- 浏览器支持检测 (Accept header)
- 帐号/配额 & 上传大小限制提示
- 服务端缓存与重复图片去重 (哈希)
- 支持裁剪、旋转、EXIF 清除
- 添加简单 CI 与单元测试

## 部署 / Docker

### 一键启动 (Docker Compose)

```powershell
docker compose build
docker compose up -d
Start-Process http://localhost:8080
```

访问 http://localhost:8080 。前端 (Nginx) 通过同域 `/api/*` 反向代理到后端容器，后端监听 4000 端口。

### 目录与镜像说明

- `backend/Dockerfile` 多阶段：构建 TypeScript -> 仅复制生产依赖与 `dist/`。
- `frontend/Dockerfile` 多阶段：用 Node 构建 Vite 产物 -> 用精简 `nginx:alpine` 提供静态资源并代理接口。
- `frontend/nginx.conf` 提供缓存策略、gzip、/api 代理与单页应用回退。
- `docker-compose.yml` 编排两个服务并把前端映射到宿主 8080 端口。

### 自定义环境变量

后端支持：
- `PORT` (默认 4000)
- `LOG_LEVEL` (info / debug)
- `MAX_FILE_SIZE` (单文件最大字节数，默认 26214400 ≈25MB)
- `RATE_WINDOW_MS` (限流窗口毫秒，默认 60000)
- `RATE_MAX` (窗口内最大请求数，默认 120)
- `MAX_CONCURRENCY` (单请求内部并行图像处理任务数，默认 4)
- `PIXEL_LIMIT` (像素上限 width*height，默认 30000000)

前端构建时可设置：
- `VITE_API_BASE` (缺省为空 -> 同域 `/api`，本地开发使用 `http://localhost:4000`)

示例：
```powershell
$env:VITE_API_BASE='http://localhost:4000'; npm --workspace frontend run dev
```

### 生产优化提示

- 如需开启 HTTPS，可在外层再加一层反向代理（例如 Caddy / Traefik / Nginx 主实例）或使用云提供商负载均衡。
- `metrics` 端点当前未做鉴权，生产建议仅内网开放或加上 Basic Auth / 网关策略。
- 可在后端添加更多指标（缓存命中率、处理错误类型分类）。
	- 已添加 `opt_cache_hit_total` / `opt_cache_miss_total` 统计命中与未命中。
- 若需要水平扩展，请把当前内存 LRU 换为 Redis / Memcached，并使用内容哈希防止重复计算。
- Sharp 已使用官方预构建二进制；若需极致瘦身，可改用 `node:slim` + `docker buildx` 做多架构构建。

### 健康检查

容器内置 HTTP 健康检查：
- 前端：Nginx 将 `/health` 代理到后端。
- 后端：`/health` 返回 `{ status: "ok" }`。

### 常见问题

1. 构建很慢：使用 `--progress=plain --no-cache` 诊断缓存；或配置 npm registry 镜像。
2. Sharp 安装失败：确认使用的基础镜像含 glibc（`node:alpine` 现支持 musl 预构建；若仍失败可改 `node:20-bullseye-slim`）。
3. 访问 API 404：确认前端 `VITE_API_BASE` 未硬编码为 localhost，已使用同域相对路径。


## License
MIT
