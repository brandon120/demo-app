import express, { type Request, type Response } from "express";
import type { IncomingMessage, ServerResponse } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { handleApiRequest } from "./api.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const distDir = path.join(__dirname, "..", "dist");

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "demo-chat",
    timestamp: new Date().toISOString(),
  });
});

app.use(async (req, res, next) => {
  if (!req.url?.startsWith("/api/")) {
    next();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const handled = await handleApiRequest(
    req as unknown as IncomingMessage,
    res as unknown as ServerResponse,
    url,
  );

  if (!handled) {
    next();
  }
});

app.use(express.static(distDir));

app.use((_req: Request, res: Response) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Demo Chat running on port ${PORT}`);
});
