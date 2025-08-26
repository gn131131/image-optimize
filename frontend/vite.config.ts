import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy: forward /api/* and /metrics to backend (default port 4000) when VITE_API_BASE not explicitly set.
// This allows frontend axios 调用使用相对路径避免跨域与硬编码。
const backendPort = process.env.BACKEND_PORT || 4000;
const enableProxy = !process.env.VITE_API_BASE; // 若用户未设置直连后端地址则使用代理

export default defineConfig({
    plugins: [react()],
    server: enableProxy
        ? {
              proxy: {
                  "/api": {
                      target: `http://localhost:${backendPort}`,
                      changeOrigin: true
                  },
                  "/metrics": {
                      target: `http://localhost:${backendPort}`,
                      changeOrigin: true
                  },
                  "/health": {
                      target: `http://localhost:${backendPort}`,
                      changeOrigin: true
                  }
              }
          }
        : undefined
});
