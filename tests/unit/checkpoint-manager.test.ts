// Unit tests for src/orchestrator/checkpoint-manager.ts
// Pure logic tests for isPhaseComplete, getPhaseData (no filesystem).

import { describe, it, expect } from "vitest";
import {
  isPhaseComplete,
  getPhaseData,
  type Checkpoint,
} from "../../src/orchestrator/checkpoint-manager.js";

function makeCheckpoint(phases: { phase: string; data: Record<string, unknown> }[]): Checkpoint {
  return {
    version: 1,
    startedAt: "2026-01-01T00:00:00.000Z",
    outputDir: "/tmp/test",
    completedPhases: phases.map((p) => ({
      phase: p.phase as "A" | "B" | "C" | "D" | "E" | "F",
      completedAt: "2026-01-01T00:01:00.000Z",
      data: p.data,
    })),
  };
}

describe("checkpoint-manager (unit)", () => {
  describe("isPhaseComplete", () => {
    it("returns false for null checkpoint", () => {
      expect(isPhaseComplete(null, "A")).toBe(false);
    });

    it("returns true for completed phase", () => {
      const cp = makeCheckpoint([{ phase: "A", data: { foo: 1 } }]);
      expect(isPhaseComplete(cp, "A")).toBe(true);
    });

    it("returns false for uncompleted phase", () => {
      const cp = makeCheckpoint([{ phase: "A", data: {} }]);
      expect(isPhaseComplete(cp, "B")).toBe(false);
    });

    it("returns true when multiple phases completed", () => {
      const cp = makeCheckpoint([
        { phase: "A", data: {} },
        { phase: "B", data: {} },
        { phase: "C", data: {} },
      ]);
      expect(isPhaseComplete(cp, "C")).toBe(true);
    });

    it("returns false for empty completedPhases", () => {
      const cp = makeCheckpoint([]);
      expect(isPhaseComplete(cp, "A")).toBe(false);
    });
  });

  describe("getPhaseData", () => {
    it("returns null for null checkpoint", () => {
      expect(getPhaseData(null, "A")).toBeNull();
    });

    it("returns data for completed phase", () => {
      const data = { scriptPath: "/tmp/script.txt", sceneCount: 5 };
      const cp = makeCheckpoint([{ phase: "A", data }]);
      expect(getPhaseData(cp, "A")).toEqual(data);
    });

    it("returns null for uncompleted phase", () => {
      const cp = makeCheckpoint([{ phase: "A", data: { x: 1 } }]);
      expect(getPhaseData(cp, "B")).toBeNull();
    });

    it("returns correct data when multiple phases exist", () => {
      const cp = makeCheckpoint([
        { phase: "A", data: { a: 1 } },
        { phase: "B", data: { b: 2 } },
      ]);
      expect(getPhaseData(cp, "B")).toEqual({ b: 2 });
    });

    it("returns null for empty completedPhases", () => {
      const cp = makeCheckpoint([]);
      expect(getPhaseData(cp, "A")).toBeNull();
    });
  });
});
