// Hono API server — routes, WebSocket, static files

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { initStore, closeStore } from "../queue/job-store.js";
import { startRunner, stopRunner } from "../queue/job-runner.js";
import { jobRoutes } from "./routes-jobs.js";
import { addClient, broadcast } from "./websocket-hub.js";

export function createServer(port = 3456) {
  const app = new Hono();

  // CORS for Vite dev server
  app.use("/api/*", cors({ origin: "http://localhost:5173" }));

  // Optional auth — set VF_AUTH_TOKEN in .env.local to enable
  const authToken = process.env.VF_AUTH_TOKEN;
  if (authToken) {
    app.use("/api/*", async (c, next) => {
      const header = c.req.header("Authorization");
      if (header !== `Bearer ${authToken}`) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      await next();
    });
    console.log("[server] Auth enabled — VF_AUTH_TOKEN required for API access");
  }

  // Initialize SQLite store
  initStore();

  // REST API routes
  app.route("/api/jobs", jobRoutes);

  // Health check
  app.get("/api/health", (c) => c.json({ status: "ok" }));

  // Serve dashboard static build (production mode)
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const dashboardDist = path.resolve(__dirname, "../dashboard/dist");

  if (fs.existsSync(dashboardDist)) {
    app.use("/*", serveStatic({ root: path.relative(process.cwd(), dashboardDist) }));
    // SPA fallback — serve index.html for non-API routes
    app.get("*", (c) => {
      const indexPath = path.join(dashboardDist, "index.html");
      const html = fs.readFileSync(indexPath, "utf-8");
      return c.html(html);
    });
  }

  // Start queue runner with WebSocket broadcast callbacks
  startRunner(
    (jobId, progress) => {
      broadcast({ type: "job:progress", jobId, progress });
    },
    (jobId, status, detail) => {
      broadcast({ type: `job:${status}`, jobId, detail });
    },
    (jobId, line) => {
      broadcast({ type: "job:log", jobId, line });
    }
  );

  // Start HTTP server
  const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
    console.log(`[server] Dashboard running at http://localhost:${info.port}`);
  });

  // Attach WebSocket server to the same HTTP server
  const wss = new WebSocketServer({ server: server as unknown as import("http").Server, path: "/ws" });
  wss.on("connection", (ws) => {
    addClient(ws);
    console.log("[ws] Client connected");
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("\n[server] Shutting down...");
    stopRunner();
    wss.close();
    closeStore();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return { app, server, wss };
}
