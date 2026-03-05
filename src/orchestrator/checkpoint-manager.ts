// Checkpoint manager — save/resume pipeline state to {output}/.checkpoint.json

import * as fs from "fs/promises";
import * as path from "path";

const CHECKPOINT_VERSION = 1;
const CHECKPOINT_FILE = ".checkpoint.json";

export type PipelinePhase = "A" | "B" | "C" | "D" | "E";

export interface PhaseCheckpoint {
  phase: PipelinePhase;
  completedAt: string;
  data: Record<string, unknown>;
}

export interface Checkpoint {
  version: number;
  startedAt: string;
  outputDir: string;
  completedPhases: PhaseCheckpoint[];
}

function checkpointPath(outputDir: string): string {
  return path.join(outputDir, CHECKPOINT_FILE);
}

/**
 * Save a completed phase to the checkpoint file.
 * Creates or updates {outputDir}/.checkpoint.json.
 */
export async function saveCheckpoint(
  outputDir: string,
  phase: PipelinePhase,
  data: Record<string, unknown>
): Promise<void> {
  const filePath = checkpointPath(outputDir);
  let checkpoint = await loadCheckpoint(outputDir);

  if (!checkpoint) {
    checkpoint = {
      version: CHECKPOINT_VERSION,
      startedAt: new Date().toISOString(),
      outputDir,
      completedPhases: [],
    };
  }

  // Replace existing phase entry if re-running
  checkpoint.completedPhases = checkpoint.completedPhases.filter(
    (p) => p.phase !== phase
  );
  checkpoint.completedPhases.push({
    phase,
    completedAt: new Date().toISOString(),
    data,
  });

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(checkpoint, null, 2), "utf-8");
}

/**
 * Load an existing checkpoint from outputDir.
 * Returns null if no checkpoint exists or if it is invalid/corrupt.
 */
export async function loadCheckpoint(outputDir: string): Promise<Checkpoint | null> {
  const filePath = checkpointPath(outputDir);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Checkpoint;
    if (parsed.version !== CHECKPOINT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Check if a specific phase is already completed in the checkpoint.
 */
export function isPhaseComplete(
  checkpoint: Checkpoint | null,
  phase: PipelinePhase
): boolean {
  if (!checkpoint) return false;
  return checkpoint.completedPhases.some((p) => p.phase === phase);
}

/**
 * Get saved phase data from the checkpoint.
 */
export function getPhaseData(
  checkpoint: Checkpoint | null,
  phase: PipelinePhase
): Record<string, unknown> | null {
  if (!checkpoint) return null;
  return checkpoint.completedPhases.find((p) => p.phase === phase)?.data ?? null;
}
