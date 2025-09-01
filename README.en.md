# Image Optimize (Fully GPT-Generated Image Compression Web App)

> This project (code + architecture notes + docs) was iteratively generated and refined with GPT assistance. Human intervention was limited to light verification and runtime testing. The goal: a modern, progress‑aware, large‑file capable online image compression experience.

## Highlights

Frontend (Vite + React):
- Drag & drop / click multi‑file import (JPG / PNG / WebP)
- Horizontal thumbnail carousel with staged progress ring (hash / upload / compress / download mapped to 0–100%)
- Center large compression ratio overlay (auto fades out on hover / selection revealing action buttons)
- Per‑item download & delete (no hover jump animation)
- Duplicate download prevention (blob fetched once per item)
- Quality control panel (vertical slider 1–100) with on‑demand re‑compression
- Original vs Compressed comparison: slider divider + pan + wheel zoom + double‑click reset + keyboard arrows
- Batched job polling (`/api/jobs`) to reduce network chatter
- Chunked upload groundwork (large file / resume support)
- Hash + quality instant reuse index ("instant upload" path when cached)
- Light / dark theme via `data-theme`
- Keyboard accessibility (Enter/Space to select, Arrow keys in compare view)

Backend (Node.js + Express + Sharp):
- Batch compression endpoint `/api/compress` (sync or async progress with `?progress=1`)
- Progress jobs state machine: queued → decoding → resizing → encoding → finalizing → done/error
- Chunked upload protocol: init → chunk → complete → (optional async job)
- Memory result cache (TTL 10 min) with byte + count eviction
- Custom promise concurrency limiter (prevents CPU saturation)
- Large pixel auto downscale (cap via `MAX_PIXELS`)
- Error coverage: oversize, unsupported type, timeout, cache overflow, incomplete upload, etc.

Limits (default):
- Single file ≤ 50MB (form upload path)
- Up to 30 files per batch, total ≤ 200MB
- Chunked path single file logical cap (configurable, default 800MB)
- Result cache ≤ 300MB or 500 items (whichever reached first)

## Directory (Simplified)
```
frontend/
  src/components   # UploadArea, ThumbCarousel, QualityPanel, CompareSlider ...
  src/utils        # chunk upload, download, helpers
backend/
  src/server.ts    # routes, compression, jobs, chunk upload, cache
  src/types/dto.ts
```

## Frontend Responsibilities
1. File ingest & preview (DataURL)
2. State management (pending / compressing / done / error + phase)
3. Batched polling → progress ring updates
4. Quality adjustment & selective recompression
5. Chunk upload slicing + session progress (core implemented)
6. Compare view interaction (zoom / pan / divider)
7. Download (single now; bulk ZIP planned)

## Backend Responsibilities
1. `/api/compress` sync or async pipeline
2. Progress queries: `/api/job/:id` & `/api/jobs?ids=...`
3. Chunk upload trio endpoints
4. Pixel & size constraints + auto downscale
5. Cache & eviction + instant reuse index (hash+quality)
6. Structured error responses

## Run (Development)
### Frontend
```powershell
cd frontend
npm install
npm run dev
```
Visit: http://localhost:5173

### Backend
```powershell
cd backend
npm install
npm run dev
```
Health: http://localhost:3001/health

### Docker Compose
```powershell
docker compose build
docker compose up -d
```
Custom port: `FRONTEND_PORT=30080` (default 18080)
```powershell
$env:FRONTEND_PORT=30080; docker compose up -d
```
Pull prebuilt images:
```powershell
docker compose pull
docker compose up -d
```
Stop:
```powershell
docker compose down
```

## Implemented ✅
- Multi-file ingest & preview
- Async jobs + batched polling
- Progress ring & stage mapping
- Center ratio overlay fade logic
- Delete / Download actions
- Chunk upload backend core
- Quality re-compress
- Compare slider + pan + zoom
- Theming (dark / light)
- Result cache with eviction
- Duplicate download guard
- Hash+quality index scaffold

## Roadmap 🔧
- Bulk ZIP download (frontend pack or backend stream)
- EXIF preservation / stripping option
- AVIF / JXL / WASM codecs integration
- PWA & offline cache
- Virtualized thumbnails (large sets)
- Expanded accessibility (ARIA grid / focus loops)
- Redis / object storage + CDN cache layer
- Worker-based hash + adaptive chunk sizing / retry

## Privacy & Security Notes
- No secrets or credentials are stored in this repo.
- Default images point to a private registry host name (`docker.pumpking.life`); ensure you want this public or replace it.
- All server limits & timeouts are environment‑configurable via standard process env vars (none mandatory leaked).
- No analytics / tracking scripts included.
- In-memory cache only (no persistent user data).

## License
MIT

---
For Chinese docs see: [README.md](./README.md)
