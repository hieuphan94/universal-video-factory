# Video Factory - Codebase Summary

## Project Statistics
- **Language:** TypeScript (ES2022)
- **Total Modules:** 11 (CLI, Orchestrator, AI Director, Capture, Voice, Compositor, Export, Server, Queue, Dashboard, Utils)
- **Type Safety:** Strict mode enabled, no `any` types
- **Build Tool:** tsup, Vite (dashboard)
- **Test Framework:** Vitest

## Directory Structure

```
video-factory/
├── src/
│   ├── ai-director/             [Phase A: Screenshot analysis + script generation]
│   │   ├── types.ts             ElementMap, ScreenshotAnalysis, GeneratedScript, ClickPlan
│   │   ├── screenshot-analyzer.ts  ScreenshotAnalyzer class (Claude Vision API)
│   │   ├── script-generator.ts   ScriptGenerator class (narration script)
│   │   ├── click-plan-builder.ts ClickPlanBuilder class (interaction plan)
│   │   └── prompts.ts           Claude prompt templates
│   │
│   ├── capture/                  [Phase B: Browser recording via Playwright]
│   │   ├── types.ts             BrowserConfig, CaptureMetadata
│   │   ├── browser-manager.ts    BrowserManager class (Playwright lifecycle)
│   │   ├── scene-recorder.ts     SceneRecorder class (execute click plan, record .webm)
│   │   ├── cursor-tracker.ts     CursorTracker class (extract cursor events)
│   │   └── manual-mode.ts        Manual recording mode handler
│   │
│   ├── cli/                      [Entry point: argument parsing + progress display]
│   │   ├── index.ts             Main CLI entry (yargs setup, pipeline invocation)
│   │   ├── parse-arguments.ts    yargs schema + ArgumentValidationError
│   │   └── progress-display.ts   ProgressDisplay class (terminal UI)
│   │
│   ├── compositor/               [Phase D: Remotion-based video composition]
│   │   ├── types.ts             BrandConfig, CompositorResult
│   │   ├── brand-loader.ts       BrandLoader class (load brand.json)
│   │   ├── render-engine.ts      renderVideo() function (Remotion renderer)
│   │   └── scene-timing-mapper.ts SceneTimingMapper class (timeline calculation)
│   │
│   ├── export/                   [Phase E: FFmpeg HEVC export]
│   │   ├── types.ts             ExportConfig, ExportResult
│   │   └── ffmpeg-exporter.ts    convertWebmToMp4(), exportFinalVideo()
│   │
│   ├── orchestrator/             [Pipeline coordination & checkpoints]
│   │   ├── types.ts             PipelineConfig, CaptureResult, PipelineResult
│   │   ├── pipeline-coordinator.ts PipelineCoordinator class (Phase A–E sequencing)
│   │   ├── checkpoint-manager.ts saveCheckpoint(), loadCheckpoint(), isPhaseComplete()
│   │   └── error-handler.ts      handleError() function (error logging)
│   │
│   ├── queue/                    [Job queue management & workers]
│   │   ├── types.ts             Job, JobStatus, JobProgress
│   │   ├── job-store.ts         JobStore class (SQLite CRUD)
│   │   ├── job-runner.ts        JobRunner class (poll queue, spawn workers)
│   │   └── job-worker.ts        Worker thread entry point
│   │
│   ├── server/                   [HTTP API + WebSocket + static serving]
│   │   ├── index.ts             createServer() function (Hono setup)
│   │   ├── routes-jobs.ts        Job REST API routes (/api/jobs)
│   │   ├── websocket-hub.ts      WebSocket client management + broadcast()
│   │   └── serve-command.ts      runServe() CLI handler
│   │
│   ├── dashboard/                [React web UI for job monitoring]
│   │   ├── vite.config.ts        Vite config
│   │   ├── src/
│   │   │   ├── api-client.ts     REST API wrapper
│   │   │   ├── use-websocket.ts  WebSocket React hook
│   │   │   └── types.ts          Frontend types
│   │   └── dist/                 Built SPA (served by HTTP server)
│   │
│   ├── voice/                    [TTS + subtitle alignment (future use)]
│   │   ├── types.ts             VoiceConfig, AudioTimestamp
│   │   ├── elevenlabs-client.ts  ElevenLabsClient class (API wrapper)
│   │   ├── whisperx-client.ts    WhisperXClient class (Python wrapper)
│   │   ├── script-preprocessor.ts ScriptPreprocessor class
│   │   └── timestamp-merger.ts   Timestamp alignment logic
│   │
│   └── utils/                    [Shared utilities]
│       ├── logger.ts            configureLogger(), getLogger() (structured logging)
│       ├── retry.ts             retry() function (exponential backoff)
│       └── cleanup.ts           cleanupTempFiles() function
│
├── tests/                        [Unit + integration tests]
│   ├── vitest.config.ts         Test configuration
│   └── *.test.ts                Test files matching src/ structure
│
├── remotion/src/                 [React video composition (Remotion)]
│   ├── components/              Video components (click highlight, zoom, karaoke subs)
│   └── universal-template/      Main Remotion composition
│
├── package.json                  Dependencies, scripts
├── tsconfig.json                 TypeScript strict config
├── .env.local (not in git)       Local secrets (API keys)
├── .env.example                  Template for .env
├── README.md                     User documentation
└── docs/                         Architecture + standards (this folder)
```

## Module Dependencies

### Import Graph (Simplified)
```
CLI
├─→ Orchestrator (pipeline-coordinator)
│   ├─→ AI Director (screenshot-analyzer, script-generator, click-plan-builder)
│   │   └─→ Capture (browser-manager)
│   ├─→ Capture (scene-recorder)
│   ├─→ Export (ffmpeg-exporter, convertWebmToMp4)
│   ├─→ Compositor (render-engine, brand-loader)
│   └─→ Orchestrator (checkpoint-manager, error-handler)
├─→ Utils (logger, retry, cleanup)
└─→ Progress Display

Server
├─→ Queue (job-store, job-runner)
├─→ WebSocket Hub (broadcast)
└─→ Routes (job REST API)

Dashboard
├─→ API Client (fetch wrapper)
└─→ WebSocket Hook

Worker Thread (spawned by job-runner)
├─→ Orchestrator (pipeline-coordinator)
└─→ (All phase modules)
```

### Dependency Flow (No Circular Dependencies)
- **Utilities** (logger, retry) — Used by all modules, depend on nothing
- **Type Modules** (types.ts in each) — Define types, depend only on other types
- **Implementation Modules** — Depend on types and utilities
- **Orchestrator** — Depends on phase modules, types, utils
- **CLI** — Depends on orchestrator, utils
- **Server** — Depends on queue, websocket (separate from pipeline)

## Key Data Structures

### Pipeline Config (CLI Input)
```typescript
{
  url: string;           // "https://app.example.com"
  feature: string;       // "create new project"
  lang: string;          // "en" | "vi" | etc
  brand?: string;        // Path to brand.json
  voice?: string;        // Path to voice config
  cookies?: string;      // Path to cookies.json
  manual: boolean;       // Pause for manual interaction
  output: string;        // "./output"
}
```

### Director Config (Phase A)
```typescript
{
  anthropicApiKey: string;
  model: "claude-sonnet-4-6";
  confidenceThreshold: number;  // 0.7 default
  viewportWidth: number;        // 1920 default
  viewportHeight: number;       // 1080 default
}
```

### Element Map (Claude Vision Output)
```typescript
{
  element: string;       // "button" | "input" | "link"
  description: string;   // "Create Project button"
  x: number;            // 100
  y: number;            // 200
  width: number;        // 120
  height: number;       // 40
  confidence: number;   // 0.95 (0–1)
  selector?: string;    // CSS selector fallback
}
```

### Click Plan (Phase A Output, Phase B Input)
```typescript
{
  url: string;
  feature: string;
  generatedAt: string;  // ISO timestamp
  actions: [{
    sceneIndex: number;
    description: string;
    narration: string;
    x: number;
    y: number;
    selector?: string;
    waitFor?: "networkidle" | "domcontentloaded" | "load" | "timeout";
    waitMs?: number;
    confidence: number;
    useFallback: boolean;
  }, ...]
}
```

### Job Record (SQLite)
```typescript
{
  id: string;            // nanoid
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  config: PipelineConfig;
  progress: {
    phase: string;       // "A", "B", "C", "D", "E"
    phaseName: string;   // "AI Director — analyze + script"
    percent: number;     // 0–100
  } | null;
  outputPath: string | null;
  error: string | null;
  createdAt: string;     // ISO timestamp
  startedAt: string | null;
  completedAt: string | null;
}
```

## Entry Points

### 1. CLI (Development & Production)
**File:** `src/cli/index.ts`
**Command:** `npm run dev` or `npm start`
**Flow:**
1. Load `.env.local` if present
2. Check for `serve` subcommand → start HTTP server, exit
3. Parse CLI arguments with yargs
4. Validate configuration (API keys, paths)
5. Create PipelineCoordinator and run
6. Display progress, handle errors, exit with code

**Exit Codes:**
- 0 = Success
- 1 = Failure (missing dependencies, validation error, pipeline error)

### 2. Server (Web Dashboard)
**File:** `src/server/index.ts`
**Command:** `video-factory serve --port=3456`
**Entrypoint:** `createServer(port)` function
**Features:**
- HTTP API on `http://localhost:3456`
- Job queue REST endpoints
- WebSocket on `/ws` for real-time progress
- Serves React SPA (from dashboard/dist)
- SQLite job store (`.video-factory.db`)
- Worker thread poll loop

### 3. Worker Thread (Background Job Execution)
**File:** `src/queue/job-worker.ts`
**Spawned By:** JobRunner (job-runner.ts)
**Communication:** Inter-process messages (progress, complete, error)
**Isolation:** Separate Node process, separate memory, separate temp files

### 4. Dashboard (Frontend)
**File:** `src/dashboard/src/main.tsx`
**Framework:** React 18 + Vite
**Build:** `npm run dashboard:build` → `src/dashboard/dist/`
**Dev:** `npm run dashboard:dev` → Vite dev server on `http://localhost:5173`
**APIs Used:**
- REST: `GET /api/jobs`, `POST /api/jobs`, `GET /api/jobs/:id`
- WebSocket: `ws://localhost:3456/ws`

## Build Pipeline

### Development
```bash
npm install              # Install dependencies
npm run typecheck        # Type check without build
npm run dev              # Run CLI from source (tsx)
npm run dashboard:dev    # Vite dev server
npm test                 # Run Vitest
npm test:watch          # Watch mode
```

### Production
```bash
npm run build            # tsup (src/ → dist/)
npm run dashboard:build  # Vite (dashboard/ → dashboard/dist/)
npm start                # Run from dist/cli/index.js
video-factory serve      # Start server (after npm start installed)
```

### Output Structure
```
dist/
├── cli/
│   ├── index.js         (entry point)
│   ├── parse-arguments.js
│   └── progress-display.js
├── orchestrator/
│   ├── pipeline-coordinator.js
│   ├── checkpoint-manager.js
│   ├── error-handler.js
│   └── types.d.ts
├── ai-director/
│   ├── screenshot-analyzer.js
│   ├── script-generator.js
│   ├── click-plan-builder.js
│   ├── prompts.js
│   └── types.d.ts
├── capture/
│   ├── browser-manager.js
│   ├── scene-recorder.js
│   ├── cursor-tracker.js
│   ├── manual-mode.js
│   └── types.d.ts
├── ... (other modules)
└── server/
    ├── index.js         (createServer)
    ├── routes-jobs.js
    ├── websocket-hub.js
    └── serve-command.js
```

## Environment Variables

### Required
```
ANTHROPIC_API_KEY=sk-...          Claude API key (Sonnet 4.6)
ELEVENLABS_API_KEY=...             ElevenLabs API key
```

### Optional (Defaults Provided)
```
VIEWPORT_WIDTH=1920
VIEWPORT_HEIGHT=1080
SCENE_RECORDING_FPS=30
PAGE_LOAD_TIMEOUT_MS=30000
CLICK_ACTION_TIMEOUT_MS=10000
CLICK_RETRY_ATTEMPTS=2
CLAUDE_VISION_CONFIDENCE_THRESHOLD=0.7
```

**Loading Order:**
1. `.env.local` (takes precedence, not in git)
2. `.env` (checked in, generic defaults)
3. Code defaults (hardcoded fallbacks)

## Phase Execution Flow

```
Phase A: AI Director (screenshot → script + click plan)
├─ Launch Playwright browser
├─ Navigate to URL (inject cookies if provided)
├─ Take screenshot (1920x1080)
├─ Analyze with Claude Vision → find interactive elements
├─ Generate narration script (multi-scene)
├─ Build click plan (x, y coords + action descriptions)
└─ Save: script.txt, click_plan.json, metadata.json

Phase B: Capture (execute click plan → record scenes)
├─ Load click_plan.json
├─ Re-launch Playwright browser
├─ For each action in plan:
│  ├─ Navigate to URL
│  ├─ Execute click/interaction
│  ├─ Record as .webm (30 fps)
│  └─ Extract cursor events
└─ Save: scenes/*.webm, capture_metadata.json

Phase C: Convert (.webm → .mp4 for Remotion)
├─ Find all .webm files in scenes/
├─ Parallel convert each to .mp4 (h264 codec)
└─ Remove source .webm files

Phase D: Compositor (Remotion composition)
├─ Load brand.json (colors, fonts, logo)
├─ Load scene metadata + script
├─ Invoke Remotion renderer with 4 concurrency
├─ Generate draft.mp4 (high-quality h264)
└─ Save: draft.mp4

Phase E: Export (FFmpeg HEVC)
├─ Read draft.mp4
├─ Detect available encoder (VideoToolbox Metal on macOS)
├─ Export to final_1080p.mp4 (HEVC codec, Metal acceleration)
└─ Save: final_1080p.mp4 (or final_720p.mp4 in preview mode)
```

## Checkpoint System

**File:** `./.checkpoint.json` in output directory

**Purpose:** Enable resume after failures mid-pipeline

**Structure:**
```typescript
{
  completedPhases: [
    { phase: "A", data: { scriptPath, clickPlanPath, metadataPath } },
    { phase: "B", data: { } },
    // ...
  ]
}
```

**Usage:**
- Save after each phase completes
- Load when `--resume` flag provided
- Skip completed phases (use cached data from checkpoint)
- Critical for long-running pipelines

## Testing Strategy

### Unit Tests
- **Target:** Utility functions (retry, logger, cleanup)
- **Coverage:** ≥80% for utilities
- **Location:** `tests/*.test.ts`
- **Execution:** `npm test`

### Integration Tests (Future)
- **Target:** Full pipeline phases (with real APIs)
- **Skip Condition:** If API keys not available
- **Approach:** Use real Anthropic/ElevenLabs with test data
- **No Mocks:** Avoid mocking services for critical paths

### Running Tests
```bash
npm test             # Run all tests once
npm run test:watch   # Watch mode for development
```

## Known Issues & Workarounds

### WhisperX Dependency
- **Status:** Optional (comment out for now)
- **Issue:** Python subprocess dependency adds complexity
- **Workaround:** Skip TTS/subtitle phase in current build
- **Future:** Integrate natively or use ElevenLabs only

### Remotion Concurrency
- **Setting:** 4 workers by default
- **Note:** Increase if hardware supports (impacts memory)
- **Monitor:** Watch RAM usage on large compositions

### FFmpeg Encoder Detection
- **Default:** VideoToolbox Metal on macOS (hardware-accelerated)
- **Fallback:** Software h264 on Linux/Windows
- **Performance:** Metal is ~5x faster than software

## Performance Baseline

**Test Conditions:** M4 24GB macOS

| Phase | Duration | Bottleneck |
|-------|----------|-----------|
| A — AI Director | ~30s | Claude Vision API latency |
| B — Capture | ~3–4 min | Browser interaction, recording |
| C — Convert | ~30s | FFmpeg webm→mp4 |
| D — Compositor | ~8 min | Remotion render (4 workers) |
| E — Export | ~1 min | FFmpeg HEVC Metal encoding |
| **Total** | ~13–15 min | Remotion + API latency |

## Future Scalability

### Planned Improvements
1. **Distributed Queue** — Move to PostgreSQL + separate workers
2. **Video Caching** — Cache generated scenes for similar URLs
3. **Parallel Workers** — Run multiple jobs across machines
4. **Storage Backend** — S3 for output videos instead of local disk
5. **Analytics** — Track video performance, user engagement

### Constraints Today
- Single-node operation (all phases on one machine)
- SQLite (fine for <100 concurrent jobs)
- Local filesystem storage (no cloud integration)
- No horizontal scaling yet

## Documentation Files

| File | Purpose |
|------|---------|
| `docs/project-overview-pdr.md` | Product requirements + roadmap |
| `docs/system-architecture.md` | Component design + data flow |
| `docs/code-standards.md` | Coding conventions + practices |
| `docs/codebase-summary.md` | This file — module overview |
| `README.md` | User guide + installation |

## Getting Started (Developer)

1. Clone repo and install dependencies
   ```bash
   git clone <repo>
   cd video-factory
   npm install
   ```

2. Set up environment
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your API keys
   ```

3. Run CLI (development mode)
   ```bash
   npm run dev -- --url=https://example.com --feature="sign up"
   ```

4. Or start web dashboard
   ```bash
   npm run dev    # In one terminal (watch mode)
   video-factory serve --port=3456  # In another
   # Open http://localhost:3456 in browser
   ```

5. Run tests
   ```bash
   npm test              # Once
   npm run test:watch    # Watch mode
   ```

## Troubleshooting

| Issue | Diagnosis | Fix |
|-------|-----------|-----|
| `ANTHROPIC_API_KEY not set` | Missing env var | Add to `.env.local` |
| `FFmpeg not found` | Missing binary | `brew install ffmpeg` |
| `Playwright timeout` | Slow network or blocked content | Increase `PAGE_LOAD_TIMEOUT_MS` |
| `Pipeline interrupted` | Killed mid-execution | Re-run with `--resume` |
| `Remotion render fails` | Memory or codec issue | Reduce concurrency or use h264 |
| `WhisperX module not found` | Python script missing | Install: `pip install whisperx` |
