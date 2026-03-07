// Shared pipeline types used across all phases

export interface PipelineConfig {
  url: string;
  feature: string;
  lang: string;
  brand?: string;
  voice?: string;
  cookies?: string;
  manual: boolean;
  output: string;
}

export interface SceneInfo {
  index: number;
  /** Path to the recorded video file */
  videoPath: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Cursor events captured during this scene */
  cursorEvents: CursorEvent[];
  /** The click action that drove this scene */
  action: ClickAction;
}

export interface CursorEvent {
  timestamp: number;
  x: number;
  y: number;
  type: "move" | "click" | "scroll";
}

export interface ClickAction {
  sceneIndex: number;
  description: string;
  x: number;
  y: number;
  /** CSS selector fallback — optional */
  selector?: string;
  /** Wait condition after action */
  waitFor?: "networkidle" | "domcontentloaded" | "load" | "timeout";
  waitMs?: number;
  /** Whether this action used Stagehand fallback */
  usedFallback?: boolean;
}

export interface CaptureResult {
  scenes: SceneInfo[];
  scriptPath: string;
  clickPlanPath: string;
  metadataPath: string;
  outputDir: string;
}

export interface ExportPhaseResult {
  finalPath: string;
  encoder: string;
  durationMs: number;
}

export interface PipelineResult {
  capture?: CaptureResult;
  export?: ExportPhaseResult;
  success: boolean;
  error?: string;
  elapsedMs: number;
}
