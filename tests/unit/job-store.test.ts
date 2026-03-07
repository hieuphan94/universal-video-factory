// Unit tests for src/queue/job-store.ts — SQLite CRUD with in-memory database

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  initStore,
  resetStore,
  createJob,
  getJob,
  listJobs,
  updateJob,
  deleteJob,
  getNextQueued,
} from "../../src/queue/job-store.js";

describe("job-store", () => {
  beforeEach(() => {
    initStore(":memory:");
  });

  afterEach(() => {
    resetStore();
  });

  describe("createJob", () => {
    it("returns a valid job object with queued status", () => {
      const job = createJob({ url: "https://example.com", feature: "test feature" });
      expect(job.id).toBeTruthy();
      expect(job.id.length).toBe(12);
      expect(job.status).toBe("queued");
      expect(job.config.url).toBe("https://example.com");
      expect(job.config.feature).toBe("test feature");
      expect(job.createdAt).toBeTruthy();
      expect(job.progress).toBeNull();
      expect(job.error).toBeNull();
    });

    it("sets default lang to 'en'", () => {
      const job = createJob({ url: "https://example.com", feature: "test" });
      expect(job.config.lang).toBe("en");
    });

    it("uses provided lang", () => {
      const job = createJob({ url: "https://example.com", feature: "test", lang: "vi" });
      expect(job.config.lang).toBe("vi");
    });

    it("creates multiple jobs with unique IDs", () => {
      const job1 = createJob({ url: "https://a.com", feature: "a" });
      const job2 = createJob({ url: "https://b.com", feature: "b" });
      expect(job1.id).not.toBe(job2.id);
    });
  });

  describe("getJob", () => {
    it("returns job by ID", () => {
      const created = createJob({ url: "https://example.com", feature: "test" });
      const found = getJob(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.config.url).toBe("https://example.com");
    });

    it("returns null for non-existent ID", () => {
      expect(getJob("nonexistent")).toBeNull();
    });
  });

  describe("listJobs", () => {
    it("returns empty array when no jobs", () => {
      expect(listJobs()).toEqual([]);
    });

    it("returns all jobs", () => {
      createJob({ url: "https://a.com", feature: "first" });
      createJob({ url: "https://b.com", feature: "second" });
      const jobs = listJobs();
      expect(jobs).toHaveLength(2);
      const features = jobs.map((j) => j.config.feature).sort();
      expect(features).toEqual(["first", "second"]);
    });

    it("filters by status", () => {
      const job1 = createJob({ url: "https://a.com", feature: "a" });
      createJob({ url: "https://b.com", feature: "b" });
      updateJob(job1.id, { status: "running", startedAt: new Date().toISOString() });

      const running = listJobs("running");
      expect(running).toHaveLength(1);
      expect(running[0].id).toBe(job1.id);

      const queued = listJobs("queued");
      expect(queued).toHaveLength(1);
    });

    it("respects limit and offset", () => {
      for (let i = 0; i < 5; i++) {
        createJob({ url: `https://${i}.com`, feature: `f${i}` });
      }
      const page1 = listJobs(undefined, 2, 0);
      expect(page1).toHaveLength(2);

      const page2 = listJobs(undefined, 2, 2);
      expect(page2).toHaveLength(2);

      const page3 = listJobs(undefined, 2, 4);
      expect(page3).toHaveLength(1);
    });
  });

  describe("updateJob", () => {
    it("updates status field", () => {
      const job = createJob({ url: "https://example.com", feature: "test" });
      updateJob(job.id, { status: "running", startedAt: new Date().toISOString() });
      const updated = getJob(job.id);
      expect(updated!.status).toBe("running");
      expect(updated!.startedAt).toBeTruthy();
    });

    it("updates progress field", () => {
      const job = createJob({ url: "https://example.com", feature: "test" });
      updateJob(job.id, { progress: { phase: "B", phaseName: "Voice", percent: 50 } });
      const updated = getJob(job.id);
      expect(updated!.progress).toEqual({ phase: "B", phaseName: "Voice", percent: 50 });
    });

    it("updates error and completedAt", () => {
      const job = createJob({ url: "https://example.com", feature: "test" });
      const now = new Date().toISOString();
      updateJob(job.id, { status: "failed", error: "Something broke", completedAt: now });
      const updated = getJob(job.id);
      expect(updated!.status).toBe("failed");
      expect(updated!.error).toBe("Something broke");
      expect(updated!.completedAt).toBe(now);
    });

    it("no-ops when no fields provided", () => {
      const job = createJob({ url: "https://example.com", feature: "test" });
      updateJob(job.id, {});
      const unchanged = getJob(job.id);
      expect(unchanged!.status).toBe("queued");
    });

    it("updates outputPath", () => {
      const job = createJob({ url: "https://example.com", feature: "test" });
      updateJob(job.id, { outputPath: "/output/abc/final.mp4" });
      const updated = getJob(job.id);
      expect(updated!.outputPath).toBe("/output/abc/final.mp4");
    });
  });

  describe("deleteJob", () => {
    it("returns true when job exists", () => {
      const job = createJob({ url: "https://example.com", feature: "test" });
      expect(deleteJob(job.id)).toBe(true);
    });

    it("returns false when job does not exist", () => {
      expect(deleteJob("nonexistent")).toBe(false);
    });

    it("actually removes the job from DB", () => {
      const job = createJob({ url: "https://example.com", feature: "test" });
      deleteJob(job.id);
      expect(getJob(job.id)).toBeNull();
    });
  });

  describe("getNextQueued", () => {
    it("returns null when no queued jobs", () => {
      expect(getNextQueued()).toBeNull();
    });

    it("returns oldest queued job", () => {
      const first = createJob({ url: "https://a.com", feature: "first" });
      createJob({ url: "https://b.com", feature: "second" });
      const next = getNextQueued();
      expect(next!.id).toBe(first.id);
    });

    it("skips non-queued jobs", () => {
      const job1 = createJob({ url: "https://a.com", feature: "a" });
      const job2 = createJob({ url: "https://b.com", feature: "b" });
      updateJob(job1.id, { status: "running" });
      const next = getNextQueued();
      expect(next!.id).toBe(job2.id);
    });
  });
});
