# Video Factory - System Architecture

## Overview

Video Factory is a full-stack system that transforms a web app URL + feature description into a polished 1080p tutorial video. The architecture separates concerns into distinct phases managed by a central orchestrator.

```
CLI Input (--url, --feature, --lang, ...)
           ↓
    Dependency Check
           ↓
    PipelineCoordinator
      ├─→ Phase A: AI Director (Claude Vision)
      ├─→ Phase B: Capture (Playwright)
      ├─→ Phase C: Convert (FFmpeg webm→mp4)
      ├─→ Phase D: Compositor (Remotion)
      └─→ Phase E: Export (FFmpeg HEVC)
           ↓
        final_1080p.mp4
```

## Component Organization

### Core Modules (src/)

#### 1. CLI (`src/cli/`)
- **Purpose:** Command-line interface, argument parsing, user interaction
- **Entry Point:** `src/cli/index.ts`
- **Key Files:**
  - `parse-arguments.ts` — yargs schema validation, config construction
  - `progress-display.ts` — Terminal progress bar + phase status
- **Responsibilities:**
  - Parse CLI arguments (url, feature, lang, brand, cookies, etc.)
  - Validate inputs and API keys (ANTHROPIC_API_KEY, ELEVENLABS_API_KEY)
  - Check system dependencies (FFmpeg, Node)
  - Instantiate PipelineCoordinator and monitor execution
  - Display real-time progress to user

#### 2. Orchestrator (`src/orchestrator/`)
- **Purpose:** Central pipeline management and error handling
- **Core Class:** `PipelineCoordinator` (pipeline-coordinator.ts)
- **Key Files:**
  - `pipeline-coordinator.ts` — Phase sequencing, checkpoint management
  - `checkpoint-manager.ts` — Save/restore pipeline state
  - `error-handler.ts` — Structured error logging
  - `types.ts` — Shared type definitions
- **Responsibilities:**
  - Execute phases A–E in sequence
  - Manage checkpoints for fault tolerance
  - Coordinate data flow between phases
  - Handle graceful shutdown and cleanup

#### 3. AI Director (`src/ai-director/`)
- **Purpose:** Scene analysis and script generation using Claude Vision
- **Key Classes:**
  - `ScreenshotAnalyzer` — Screenshot → element analysis
  - `ScriptGenerator` — Elements → narration script
  - `ClickPlanBuilder` — Script → interaction plan
- **Key Files:**
  - `screenshot-analyzer.ts` — Claude Vision API calls
  - `script-generator.ts` — Prompt engineering + script parsing
  - `click-plan-builder.ts` — Build clickable action sequence
  - `prompts.ts` — Claude prompt templates
  - `types.ts` — DirectorConfig, ElementMap, ClickPlan
- **Dependencies:** Anthropic SDK, Playwright (screenshot)
- **Outputs:** click_plan.json, script.txt, metadata

#### 4. Capture (`src/capture/`)
- **Purpose:** Browser automation and video recording
- **Key Classes:**
  - `BrowserManager` — Playwright browser lifecycle
  - `SceneRecorder` — Execute click plan, record video
  - `CursorTracker` — Track mouse movement during recording
- **Key Files:**
  - `browser-manager.ts` — Launch, navigate, screenshot, manage browser
  - `scene-recorder.ts` — Record each scene as .webm video
  - `cursor-tracker.ts` — Extract cursor events from recording
  - `manual-mode.ts` — Pause for manual navigation
  - `types.ts` — BrowserConfig, CaptureMetadata
- **Dependencies:** Playwright
- **Outputs:** scenes/*.webm (raw recordings)

#### 5. Voice (`src/voice/`)
- **Purpose:** Text-to-speech synthesis and subtitle alignment
- **Key Classes:**
  - `ElevenLabsClient` — API wrapper for TTS
  - `WhisperXClient` — Speech-to-text with forced alignment
  - `ScriptPreprocessor` — Prepare script for TTS
- **Key Files:**
  - `elevenlabs-client.ts` — ElevenLabs API integration
  - `whisperx-client.ts` — WhisperX CLI wrapper (Python)
  - `timestamp-merger.ts` — Align audio timestamps
  - `types.ts` — VoiceConfig, AudioTimestamp
- **Dependencies:** ElevenLabs API, WhisperX (Python), FFmpeg
- **Outputs:** audio/*.mp3, timestamps JSON

#### 6. Compositor (`src/compositor/`)
- **Purpose:** Remotion-based video composition and rendering
- **Key Classes:**
  - `BrandLoader` — Load brand config (colors, fonts, logo)
  - `RenderEngine` — Remotion video composition
  - `SceneTimingMapper` — Map scene duration to timeline
- **Key Files:**
  - `brand-loader.ts` — Parse brand.json, validate
  - `render-engine.ts` — Invoke Remotion renderer
  - `scene-timing-mapper.ts` — Calculate timing metadata
  - `types.ts` — BrandConfig, CompositorResult
- **Dependencies:** @remotion/bundler, @remotion/renderer, React
- **Outputs:** draft.mp4, Remotion composition

#### 7. Export (`src/export/`)
- **Purpose:** FFmpeg-based final video encoding
- **Key Classes:**
  - `FFmpegExporter` — Hardware-accelerated export
- **Key Files:**
  - `ffmpeg-exporter.ts` — FFmpeg command construction
  - `types.ts` — ExportConfig, ExportResult
- **Dependencies:** FFmpeg (binary), child_process
- **Outputs:** final_1080p.mp4 (or final_720p.mp4 in preview mode)

#### 8. Server (`src/server/`)
- **Purpose:** HTTP API + WebSocket dashboard backend
- **Key Files:**
  - `index.ts` — Hono server setup, CORS, static files
  - `routes-jobs.ts` — Job queue REST API
  - `websocket-hub.ts` — WebSocket client management + broadcast
  - `serve-command.ts` — CLI "serve" subcommand handler
- **Dependencies:** Hono, ws (WebSocket)
- **Routes:**
  - `GET /api/health` — Health check
  - `GET /api/jobs` — List all jobs
  - `POST /api/jobs` — Create new job
  - `GET /api/jobs/:id` — Get job status
  - `WS /ws` — WebSocket connection
  - `GET *` — Serve dashboard SPA

#### 9. Queue (`src/queue/`)
- **Purpose:** Job queue management and worker processing
- **Key Classes:**
  - `JobStore` — SQLite database for job persistence
  - `JobRunner` — Long-running worker thread
  - `JobWorker` — Worker thread subprocess
- **Key Files:**
  - `job-store.ts` — CRUD operations on jobs table
  - `job-runner.ts` — Poll queue, spawn workers
  - `job-worker.ts` — Worker thread entry point
  - `types.ts` — Job, JobStatus, JobProgress
- **Dependencies:** better-sqlite3 (database), nanoid (ID generation)
- **Storage:** `.video-factory.db` (SQLite)

#### 10. Dashboard (`src/dashboard/`)
- **Purpose:** React web UI for job monitoring
- **Key Files:**
  - `src/api-client.ts` — API wrapper (fetch)
  - `src/use-websocket.ts` — WebSocket hook
  - `src/types.ts` — Frontend types
  - `vite.config.ts` — Vite build config
- **Framework:** React, Vite
- **Features:** Job list, real-time progress, status display

#### 11. Utils (`src/utils/`)
- **Purpose:** Shared utilities and logging
- **Key Files:**
  - `logger.ts` — Structured JSON logging to file
  - `retry.ts` — Exponential backoff retry wrapper
  - `cleanup.ts` — Temporary file cleanup
- **Used By:** All modules

## Data Flow

### Phase A: AI Director
```
screenshot.png (from Playwright)
       ↓
[Claude Vision Analysis]
       ↓
ElementMap[] (interactive elements)
       ↓
[Script Generation] + [Click Plan Builder]
       ↓
script.txt + click_plan.json
```

**Type Bridge:** `DirectorConfig` → outputs typed as `ClickPlan` and `GeneratedScript`

### Phase B: Capture
```
click_plan.json (from Phase A)
       ↓
[Browser Navigation + Click Execution]
       ↓
scenes/*.webm (raw video clips)
       ↓
capture_metadata.json (timing + cursor events)
```

**Type Bridge:** `CaptureMetadata` tracks timing and cursor positions per scene

### Phase C: Convert
```
scenes/*.webm
       ↓
[FFmpeg Conversion]
       ↓
scenes/*.mp4 (h264 codec)
```

### Phase D: Compositor
```
scenes/*.mp4 + script.txt + brand.json
       ↓
[Remotion Composition]
       ↓
draft.mp4 (high-quality intermediate)
```

**Config:** `BrandConfig` defines colors, fonts, logo, intro/outro

### Phase E: Export
```
draft.mp4
       ↓
[FFmpeg HEVC Metal]
       ↓
final_1080p.mp4 (or final_720p.mp4)
```

## Configuration & Environment

### CLI Configuration (`PipelineConfig`)
```typescript
{
  url: string;              // Target web app
  feature: string;          // Feature to demonstrate
  lang: string;             // Narration language (default: en)
  brand?: string;           // Path to brand.json
  voice?: string;           // Path to voice config
  cookies?: string;         // Path to cookies.json
  manual: boolean;          // Pause for manual interaction
  output: string;           // Output directory
}
```

### Environment Variables
```
ANTHROPIC_API_KEY=sk-...          (required)
ELEVENLABS_API_KEY=...            (required)
VIEWPORT_WIDTH=1920                (default)
VIEWPORT_HEIGHT=1080               (default)
SCENE_RECORDING_FPS=30             (default)
PAGE_LOAD_TIMEOUT_MS=30000         (default)
CLICK_ACTION_TIMEOUT_MS=10000      (default)
CLICK_RETRY_ATTEMPTS=2             (default)
CLAUDE_VISION_CONFIDENCE_THRESHOLD=0.7  (default)
```

Load from `.env.local` (takes precedence) or `.env`.

### Brand Configuration (brand.json)
```json
{
  "name": "My Company",
  "colors": {
    "primary": "#2563EB",
    "accent": "#FFD700"
  },
  "fonts": {
    "heading": "Inter",
    "body": "Inter"
  },
  "intro": { "tagline": "See how it works", "duration": 3 },
  "outro": { "cta": "Try it free", "url": "https://...", "duration": 4 }
}
```

## Checkpoint System

Each phase saves a checkpoint after completion to `{output}/.checkpoint.json`:

```typescript
{
  completedPhases: [
    { phase: "A", data: { scriptPath, clickPlanPath, ... } },
    { phase: "B", data: { } },
    ...
  ]
}
```

When `--resume` is passed, completed phases are skipped, allowing recovery from failures mid-pipeline.

## Error Handling

### Error Categories
1. **Validation Errors** — Missing args, invalid config
2. **API Errors** — Anthropic/ElevenLabs failures
3. **Browser Errors** — Playwright failures, page load timeouts
4. **Filesystem Errors** — Missing files, write permissions
5. **Conversion Errors** — FFmpeg/Remotion failures

### Retry Strategy
- CLI dependencies (ffmpeg, node): single check, fail fast
- Browser operations: configurable retry with exponential backoff
- API calls: built-in retry via SDK
- Screenshot analysis: fallback to Stagehand if confidence < threshold

### Logging
- Structured JSON logs to `{output}/pipeline.log`
- Console output with phase summaries
- Error stack traces captured in logs only

## Server Architecture

### HTTP Server (Hono)
- Listen on `127.0.0.1:3456` (localhost only)
- REST API for job management
- Serve static dashboard build (`src/dashboard/dist`)
- SPA fallback for React Router

### WebSocket Server
- Attached to same HTTP server
- Path: `/ws`
- Broadcast job progress to all connected clients
- Message types: `job:progress`, `job:complete`, `job:failed`

### Job Queue
- SQLite database (`.video-factory.db`)
- Worker thread polls for `queued` jobs
- Spawns child process for each job (isolated environment)
- Updates parent via inter-process messaging

### Authentication
- None (localhost-only access)
- Consider adding token auth before production exposure

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Runtime** | Node.js | 20+ |
| **Language** | TypeScript | 5.7+ |
| **Browser** | Playwright | 1.50+ |
| **Vision API** | Anthropic SDK | 0.36+ |
| **TTS** | ElevenLabs SDK | (via REST) |
| **Video Encoder** | Remotion | 4.0+ |
| **Export** | FFmpeg | (binary) |
| **HTTP Server** | Hono | 4.12+ |
| **Database** | SQLite 3 | (better-sqlite3) |
| **Frontend** | React | 18+ |
| **Build** | Vite | 5+ |
| **Test Framework** | Vitest | 1.0+ |

## Deployment Considerations

### Single-Server Setup
- All phases run locally on CLI machine
- API server (dashboard) runs on same machine
- SQLite database stored in `.video-factory.db`
- Suitable for development and small-scale production

### Future: Distributed Setup
- API server: dedicated node
- Worker queue: separate worker machines
- Database: managed PostgreSQL
- S3/Cloud Storage for video artifacts
- Load balancer for multiple API instances

## File Structure Summary
```
src/
├── ai-director/        [Phase A: Scene analysis + script]
├── capture/           [Phase B: Browser recording]
├── cli/               [Entry point + argument parsing]
├── compositor/        [Phase D: Remotion composition]
├── dashboard/         [React web UI]
├── export/            [Phase E: FFmpeg export]
├── orchestrator/      [Pipeline coordination]
├── queue/             [Job queue + workers]
├── server/            [HTTP API + WebSocket]
├── utils/             [Logging, retry, cleanup]
└── voice/             [TTS + subtitle alignment]
```

## Key Design Patterns

1. **Orchestrator Pattern** — `PipelineCoordinator` sequences phases
2. **Checkpoint Pattern** — Save state between phases for resumption
3. **Composition Pattern** — Remotion for layered video construction
4. **Client-Server Pattern** — Hono API + React frontend
5. **Worker Thread Pattern** — Long-running jobs in separate processes
6. **Type Safety** — TypeScript strict mode throughout

## Integration Points

- **CLI ↔ Orchestrator:** Invoke `coordinator.run()`, monitor progress
- **Phases ↔ Storage:** Read/write to output directory
- **Coordinator ↔ Server:** (Decoupled; jobs run via worker threads)
- **Dashboard ↔ API:** REST + WebSocket for real-time updates
- **Browser ↔ Playwright:** Use `playwright` binary from node_modules

