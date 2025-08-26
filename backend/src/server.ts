import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
});

// 占位：未来可扩展后端压缩 / 任务队列 / 账号体系

const port = process.env.PORT || 3001;
app.listen(port, () => {
    console.log(`Backend server listening on :${port}`);
});
