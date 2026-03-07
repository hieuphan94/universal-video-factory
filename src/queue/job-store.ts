// SQLite job store — CRUD operations for video generation jobs

import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import * as path from "path";
import * as fs from "fs";
import type { Job, JobStatus, JobCreateInput, JobProgress } from "./types.js";
import type { PipelineConfig } from "../orchestrator/types.js";

const DB_DIR = path.resolve("data");
const DB_PATH = path.join(DB_DIR, "video-factory.db");

let db: Database.Database | null = null;

/** Initialize SQLite database and create tables. Pass ":memory:" for testing. */
export function initStore(dbPath?: string): Database.Database {
  if (db) return db;

  const resolvedPath = dbPath ?? DB_PATH;
  if (resolvedPath !== ":memory:") {
    const dir = path.dirname(resolvedPath);
    fs.mkdirSync(dir, { recursive: true });
  }
  db = new Database(resolvedPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id           TEXT PRIMARY KEY,
      status       TEXT NOT NULL DEFAULT 'queued',
      config       TEXT NOT NULL,
      progress     TEXT,
      output_path  TEXT,
      error        TEXT,
      created_at   TEXT NOT NULL,
      started_at   TEXT,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);
  `);

  return db;
}

/** Get the database instance (must call initStore first) */
function getDb(): Database.Database {
  if (!db) throw new Error("Job store not initialized. Call initStore() first.");
  return db;
}

/** Create a new job from user input, returns the created job */
export function createJob(input: JobCreateInput): Job {
  const d = getDb();
  const id = nanoid(12);
  const now = new Date().toISOString();

  const config: PipelineConfig = {
    url: input.url,
    feature: input.feature,
    lang: input.lang ?? "en",
    brand: input.brand,
    voice: input.voice,
    cookies: input.cookies,
    manual: false,
    output: path.resolve("output", id),
  };

  d.prepare(
    `INSERT INTO jobs (id, status, config, created_at) VALUES (?, 'queued', ?, ?)`
  ).run(id, JSON.stringify(config), now);

  return {
    id,
    status: "queued",
    config,
    progress: null,
    outputPath: null,
    error: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
  };
}

/** Parse a raw SQLite row into a typed Job object */
function rowToJob(row: Record<string, unknown>): Job {
  return {
    id: row.id as string,
    status: row.status as JobStatus,
    config: JSON.parse(row.config as string) as PipelineConfig,
    progress: row.progress ? (JSON.parse(row.progress as string) as JobProgress) : null,
    outputPath: (row.output_path as string) ?? null,
    error: (row.error as string) ?? null,
    createdAt: row.created_at as string,
    startedAt: (row.started_at as string) ?? null,
    completedAt: (row.completed_at as string) ?? null,
  };
}

/** Get a single job by ID, returns null if not found */
export function getJob(id: string): Job | null {
  const row = getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToJob(row) : null;
}

/** List jobs with optional status filter and pagination */
export function listJobs(
  status?: JobStatus,
  limit = 20,
  offset = 0
): Job[] {
  const d = getDb();
  if (status) {
    const rows = d
      .prepare("SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(status, limit, offset) as Record<string, unknown>[];
    return rows.map(rowToJob);
  }
  const rows = d
    .prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .all(limit, offset) as Record<string, unknown>[];
  return rows.map(rowToJob);
}

/** Update job fields (partial update) */
export function updateJob(
  id: string,
  fields: {
    status?: JobStatus;
    progress?: JobProgress;
    outputPath?: string;
    error?: string;
    startedAt?: string;
    completedAt?: string;
  }
): void {
  const d = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (fields.status !== undefined) { sets.push("status = ?"); values.push(fields.status); }
  if (fields.progress !== undefined) { sets.push("progress = ?"); values.push(JSON.stringify(fields.progress)); }
  if (fields.outputPath !== undefined) { sets.push("output_path = ?"); values.push(fields.outputPath); }
  if (fields.error !== undefined) { sets.push("error = ?"); values.push(fields.error); }
  if (fields.startedAt !== undefined) { sets.push("started_at = ?"); values.push(fields.startedAt); }
  if (fields.completedAt !== undefined) { sets.push("completed_at = ?"); values.push(fields.completedAt); }

  if (sets.length === 0) return;
  values.push(id);
  d.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

/** Delete a job by ID */
export function deleteJob(id: string): boolean {
  const result = getDb().prepare("DELETE FROM jobs WHERE id = ?").run(id);
  return result.changes > 0;
}

/** Get the next queued job (oldest first) */
export function getNextQueued(): Job | null {
  const row = getDb()
    .prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1")
    .get() as Record<string, unknown> | undefined;
  return row ? rowToJob(row) : null;
}

/** Close the database connection */
export function closeStore(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** Reset store for testing — close db and clear singleton so initStore can be called again */
export function resetStore(): void {
  closeStore();
}
