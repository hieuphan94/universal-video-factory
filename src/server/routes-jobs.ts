// REST API routes for job CRUD operations

import { Hono } from "hono";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { createJob, getJob, listJobs, updateJob, deleteJob } from "../queue/job-store.js";
import { cancelRunningJob, getActiveJobId } from "../queue/job-runner.js";
import { broadcast } from "./websocket-hub.js";
import type { JobStatus } from "../queue/types.js";

const jobCreateSchema = z.object({
  url: z.string().url("Must be a valid URL"),
  feature: z.string().min(1, "Feature description required"),
  lang: z.string().optional(),
  brand: z.string().optional(),
  voice: z.string().optional(),
  cookies: z.string().optional(),
  preview: z.boolean().optional(),
});

export const jobRoutes = new Hono();

// POST /api/jobs — create a new job
jobRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = jobCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten().fieldErrors }, 400);
  }

  const job = createJob(parsed.data);
  broadcast({ type: "job:created", job });
  return c.json(job, 201);
});

// GET /api/jobs — list jobs with optional filters
jobRoutes.get("/", (c) => {
  const status = c.req.query("status") as JobStatus | undefined;
  const limit = parseInt(c.req.query("limit") ?? "20", 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);

  const jobs = listJobs(status, limit, offset);
  return c.json({ jobs, count: jobs.length });
});

// GET /api/jobs/:id — single job detail
jobRoutes.get("/:id", (c) => {
  const job = getJob(c.req.param("id"));
  if (!job) return c.json({ error: "Job not found" }, 404);
  return c.json(job);
});

// DELETE /api/jobs/:id — cancel or delete a job
jobRoutes.delete("/:id", (c) => {
  const id = c.req.param("id");
  const job = getJob(id);
  if (!job) return c.json({ error: "Job not found" }, 404);

  if (job.status === "running") {
    const cancelled = cancelRunningJob(id);
    if (!cancelled) return c.json({ error: "Could not cancel running job" }, 500);
    broadcast({ type: "job:cancelled", jobId: id });
    return c.json({ message: "Job cancelled" });
  }

  if (job.status === "queued") {
    updateJob(id, { status: "cancelled", completedAt: new Date().toISOString() });
    broadcast({ type: "job:cancelled", jobId: id });
    return c.json({ message: "Job cancelled" });
  }

  // Completed/failed/cancelled — delete from DB
  deleteJob(id);
  return c.json({ message: "Job deleted" });
});

// GET /api/jobs/:id/logs — return accumulated log lines for a job
jobRoutes.get("/:id/logs", (c) => {
  const job = getJob(c.req.param("id"));
  if (!job) return c.json({ error: "Job not found" }, 404);

  // Derive log file path — prevent directory traversal
  const logPath = path.resolve("output", c.req.param("id"), "pipeline.log");
  const outputBase = path.resolve("output");
  if (!logPath.startsWith(outputBase)) {
    return c.json({ error: "Invalid path" }, 403);
  }

  if (!fs.existsSync(logPath)) {
    return c.json({ lines: [] });
  }

  const content = fs.readFileSync(logPath, "utf-8");
  const lines = content.split("\n").filter((l) => l.length > 0);
  return c.json({ lines });
});

// GET /api/jobs/:id/output — stream the output video file
jobRoutes.get("/:id/output", (c) => {
  const job = getJob(c.req.param("id"));
  if (!job) return c.json({ error: "Job not found" }, 404);
  if (!job.outputPath) return c.json({ error: "No output available" }, 404);

  // Prevent directory traversal — resolve and verify path is under output/
  const resolved = path.resolve(job.outputPath);
  const outputBase = path.resolve("output");
  if (!resolved.startsWith(outputBase)) {
    return c.json({ error: "Invalid output path" }, 403);
  }

  if (!fs.existsSync(resolved)) {
    return c.json({ error: "Output file not found on disk" }, 404);
  }

  const stat = fs.statSync(resolved);
  const stream = fs.createReadStream(resolved);

  return new Response(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": stat.size.toString(),
      "Content-Disposition": `inline; filename="${path.basename(resolved)}"`,
    },
  });
});
