// CLI progress display — spinner + phase tracking + ETA + summary

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;

interface PhaseState {
  name: string;
  startedAt: number;
  completedAt?: number;
  itemCurrent?: number;
  itemTotal?: number;
}

export class ProgressDisplay {
  private phases: Map<string, PhaseState> = new Map();
  private currentPhase: string | null = null;
  private spinnerFrame = 0;
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;
  private pipelineStart = Date.now();
  private isTTY = process.stderr.isTTY ?? false;

  /** Start a named pipeline phase. */
  startPhase(id: string, name: string, itemTotal?: number): void {
    this.phases.set(id, {
      name,
      startedAt: Date.now(),
      itemTotal,
      itemCurrent: 0,
    });
    this.currentPhase = id;
    this.renderLine(`Starting: ${name}${itemTotal ? ` (0/${itemTotal})` : ""}`);
    this.startSpinner();
  }

  /** Update item progress within the current phase. */
  updateProgress(id: string, current: number, total?: number): void {
    const phase = this.phases.get(id);
    if (!phase) return;
    phase.itemCurrent = current;
    if (total !== undefined) phase.itemTotal = total;
    this.renderCurrent();
  }

  /** Mark a phase as complete and print elapsed time. */
  completePhase(id: string): void {
    const phase = this.phases.get(id);
    if (!phase) return;
    phase.completedAt = Date.now();
    const elapsed = ((phase.completedAt - phase.startedAt) / 1000).toFixed(1);
    this.clearSpinner();
    this.renderLine(`Done:  ${phase.name} (${elapsed}s)`);
    this.currentPhase = null;
  }

  /** Print the final summary line. */
  summary(outputPath: string): void {
    this.clearSpinner();
    const totalSec = ((Date.now() - this.pipelineStart) / 1000).toFixed(1);
    console.log(`\n[video-factory] Pipeline complete in ${totalSec}s`);
    console.log(`[video-factory] Output: ${outputPath}`);
  }

  private renderCurrent(): void {
    const id = this.currentPhase;
    if (!id) return;
    const phase = this.phases.get(id);
    if (!phase) return;
    const itemInfo =
      phase.itemTotal ? ` (${phase.itemCurrent ?? 0}/${phase.itemTotal})` : "";
    const elapsedSec = ((Date.now() - phase.startedAt) / 1000).toFixed(0);
    this.renderLine(`${phase.name}${itemInfo} — ${elapsedSec}s`);
  }

  private renderLine(msg: string): void {
    if (this.isTTY) {
      process.stderr.write(`\r\x1b[K[video-factory] ${msg}`);
    } else {
      process.stderr.write(`[video-factory] ${msg}\n`);
    }
  }

  private startSpinner(): void {
    if (!this.isTTY || this.spinnerTimer) return;
    this.spinnerTimer = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
      this.renderCurrent();
    }, SPINNER_INTERVAL_MS);
    if (this.spinnerTimer.unref) this.spinnerTimer.unref();
  }

  private clearSpinner(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
    if (this.isTTY) process.stderr.write("\r\x1b[K");
  }
}
