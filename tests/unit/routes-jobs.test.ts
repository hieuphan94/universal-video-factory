// Unit tests for src/server/routes-jobs.ts — Hono route handlers
// Mocks job-store and job-runner to test route logic in isolation.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

// Mock job-store before importing routes
vi.mock("../../src/queue/job-store.js", () => ({
  createJob: vi.fn(),
  getJob: vi.fn(),
  listJobs: vi.fn(),
  updateJob: vi.fn(),
  deleteJob: vi.fn(),
}));

vi.mock("../../src/queue/job-runner.js", () => ({
  cancelRunningJob: vi.fn(),
  getActiveJobId: vi.fn(),
}));

vi.mock("../../src/server/websocket-hub.js", () => ({
  broadcast: vi.fn(),
}));

import { jobRoutes } from "../../src/server/routes-jobs.js";
import * as jobStore from "../../src/queue/job-store.js";
import * as jobRunner from "../../src/queue/job-runner.js";

const app = new Hono();
app.route("/api/jobs", jobRoutes);

function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) init.body = JSON.stringify(body);
  return app.request(`http://localhost${path}`, init);
}

describe("routes-jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/jobs", () => {
    it("returns 201 with valid input", async () => {
      const mockJob = { id: "abc123", status: "queued", config: { url: "https://example.com", feature: "test" } };
      vi.mocked(jobStore.createJob).mockReturnValue(mockJob as never);

      const res = await req("POST", "/api/jobs", { url: "https://example.com", feature: "test feature" });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.id).toBe("abc123");
    });

    it("returns 400 for invalid URL", async () => {
      const res = await req("POST", "/api/jobs", { url: "not-a-url", feature: "test" });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBeTruthy();
    });

    it("returns 400 for missing feature", async () => {
      const res = await req("POST", "/api/jobs", { url: "https://example.com" });
      expect(res.status).toBe(400);
    });

    it("returns 400 for empty feature", async () => {
      const res = await req("POST", "/api/jobs", { url: "https://example.com", feature: "" });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/jobs", () => {
    it("returns job list", async () => {
      vi.mocked(jobStore.listJobs).mockReturnValue([]);
      const res = await req("GET", "/api/jobs");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.jobs).toEqual([]);
      expect(data.count).toBe(0);
    });

    it("passes status filter to store", async () => {
      vi.mocked(jobStore.listJobs).mockReturnValue([]);
      await req("GET", "/api/jobs?status=running");
      expect(jobStore.listJobs).toHaveBeenCalledWith("running", 20, 0);
    });

    it("passes limit and offset", async () => {
      vi.mocked(jobStore.listJobs).mockReturnValue([]);
      await req("GET", "/api/jobs?limit=5&offset=10");
      expect(jobStore.listJobs).toHaveBeenCalledWith(undefined, 5, 10);
    });
  });

  describe("GET /api/jobs/:id", () => {
    it("returns 404 for non-existent job", async () => {
      vi.mocked(jobStore.getJob).mockReturnValue(null);
      const res = await req("GET", "/api/jobs/nonexistent");
      expect(res.status).toBe(404);
    });

    it("returns job details", async () => {
      const mockJob = { id: "abc123", status: "queued" };
      vi.mocked(jobStore.getJob).mockReturnValue(mockJob as never);
      const res = await req("GET", "/api/jobs/abc123");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe("abc123");
    });
  });

  describe("DELETE /api/jobs/:id", () => {
    it("returns 404 for non-existent job", async () => {
      vi.mocked(jobStore.getJob).mockReturnValue(null);
      const res = await req("DELETE", "/api/jobs/nonexistent");
      expect(res.status).toBe(404);
    });

    it("cancels running job via job-runner", async () => {
      vi.mocked(jobStore.getJob).mockReturnValue({ id: "abc", status: "running" } as never);
      vi.mocked(jobRunner.cancelRunningJob).mockReturnValue(true);
      const res = await req("DELETE", "/api/jobs/abc");
      expect(res.status).toBe(200);
      expect(jobRunner.cancelRunningJob).toHaveBeenCalledWith("abc");
    });

    it("cancels queued job by updating status", async () => {
      vi.mocked(jobStore.getJob).mockReturnValue({ id: "abc", status: "queued" } as never);
      const res = await req("DELETE", "/api/jobs/abc");
      expect(res.status).toBe(200);
      expect(jobStore.updateJob).toHaveBeenCalledWith("abc", expect.objectContaining({ status: "cancelled" }));
    });

    it("deletes completed job from DB", async () => {
      vi.mocked(jobStore.getJob).mockReturnValue({ id: "abc", status: "completed" } as never);
      vi.mocked(jobStore.deleteJob).mockReturnValue(true);
      const res = await req("DELETE", "/api/jobs/abc");
      expect(res.status).toBe(200);
      expect(jobStore.deleteJob).toHaveBeenCalledWith("abc");
    });
  });

  describe("GET /api/jobs/:id/logs — path traversal guard", () => {
    it("returns 404 for non-existent job", async () => {
      vi.mocked(jobStore.getJob).mockReturnValue(null);
      const res = await req("GET", "/api/jobs/../../etc/logs");
      expect(res.status).toBe(404);
    });

    it("returns empty lines for job without log file", async () => {
      vi.mocked(jobStore.getJob).mockReturnValue({ id: "safe-id", status: "queued" } as never);
      const res = await req("GET", "/api/jobs/safe-id/logs");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.lines).toEqual([]);
    });
  });

  describe("GET /api/jobs/:id/output — path traversal guard", () => {
    it("returns 404 for non-existent job", async () => {
      vi.mocked(jobStore.getJob).mockReturnValue(null);
      const res = await req("GET", "/api/jobs/test/output");
      expect(res.status).toBe(404);
    });

    it("returns 404 when no outputPath set", async () => {
      vi.mocked(jobStore.getJob).mockReturnValue({ id: "abc", status: "completed", outputPath: null } as never);
      const res = await req("GET", "/api/jobs/abc/output");
      expect(res.status).toBe(404);
    });

    it("returns 403 for path traversal attempt", async () => {
      vi.mocked(jobStore.getJob).mockReturnValue({
        id: "abc", status: "completed",
        outputPath: "../../../etc/passwd",
      } as never);
      const res = await req("GET", "/api/jobs/abc/output");
      expect(res.status).toBe(403);
    });
  });
});
