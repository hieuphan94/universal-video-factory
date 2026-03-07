# Video Factory - System Architecture

## Overview

Video Factory is a modular system for creating tutorial videos via two distinct pipelines:

1. **Legacy Auto Pipeline** (fully automated, internal use): URL + feature → AI Director → Playwright capture → Remotion render → FFmpeg export
2. **Human-Assisted Tutorial Pipeline** (primary, production): Human records screen + script overlay → cursor detection → marker generation → Remotion render → FFmpeg export

Both pipelines share a common rendering layer (Remotion composition, ElevenLabs voice, FFmpeg export) with different inputs: auto-captured video vs. human-recorded screen.

### Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     LEGACY AUTO PIPELINE                         │
├─────────────────────────────────────────────────────────────────┤
│ CLI → AI Director (Vision) → Playwright Capture → Compositor → │
│ FFmpeg Export                                                   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                 HUMAN-ASSISTED TUTORIAL PIPELINE                 │
├─────────────────────────────────────────────────────────────────┤
│ Script Generator → Human Recorder → Cursor Detection → Markers  │
│        ↓                 ↓              ↓              ↓         │
│    (LLM)        (Playwright         (Automated)   (JSON        │
│                  Overlay)                          markers.json) │
│                                                         ↓        │
│                                        Voice TTS → Compositor   │
│                                                  → FFmpeg Export │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      CLIPS COMPOSE PIPELINE                      │
├─────────────────────────────────────────────────────────────────┤
│ Record Action Clip → Clips Catalog → Compose Manifest → Voice  │
│                                             → Compositor → Export│
└─────────────────────────────────────────────────────────────────┘

           ┌──────────────────────────────────┐
           │     SHARED RENDERING LAYER        │
           ├──────────────────────────────────┤
           │ • ElevenLabs TTS + Timestamps    │
           │ • Remotion Composition           │
           │ • FFmpeg HEVC Encoding           │
           │ • Brand customization            │
           └──────────────────────────────────┘
```

## Component Organization

### Core Modules (src/)

#### 1. CLI (`src/cli/`)
- **Purpose:** Multi-command interface for all pipelines
- **Entry Point:** `src/cli/index.ts`
- **Subcommands:**
  - `tutorial` — Human-assisted tutorial pipeline (primary)
  - `record-clip` — Record single action clip
  - `clips` — Manage clip catalog (list, info, remove)
  - `compose` — Compose clips with voice
  - `serve` — Start API server with job queue
- **Key Files:**
  - `parse-arguments.ts` — yargs schema for all commands
  - `progress-display.ts` — Terminal progress bar
  - `tutorial-command.ts` — Tutorial pipeline entry
  - `record-clip-command.ts` — Single clip recording
  - `clips-*.ts` — Clip catalog commands
  - `compose-command.ts` — Clip composition
  - `serve-command.ts` — API server
- **Validates:** ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, FFmpeg, Node

#### 2. Script Generator (`src/script/`)
- **Purpose:** Generate tutorial narration script from web app + purpose
- **Key Files:**
  - `script-generator.ts` — LLM prompt + parsing
  - `types.ts` — ScriptConfig, GeneratedScript
- **Inputs:** URL, purpose, tree-id context (optional)
- **Outputs:** script.json with scene descriptions + narration
- **CLI:** `generate-script --url <url> --purpose <text> [--tree-id <id>]`

#### 3. Recorder (`src/recorder/`)
- **Purpose:** Human screen recording with script overlay + event tracking
- **Key Classes:**
  - `SceneRecorder` — Record browser screen with Playwright + overlay panel
  - `OverlayPanel` — Floating UI showing current script step
  - `EventCapture` — Track cursor, clicks, keys → events.json
- **Key Files:**
  - `scene-recorder.ts` — Main recording orchestrator
  - `overlay-panel.ts` — Step counter + navigation (Space=next, Esc=stop)
  - `event-capture.ts` — Cursor/click/key event tracking
  - `types.ts` — RecorderConfig, EventsFile, Event
- **Inputs:** Script, URL
- **Outputs:** recording.webm + events.json (cursor/click/key events with timestamps)
- **CLI:** `record --url <url> --script <path>`

#### 4. Detection (`src/detection/`)
- **Purpose:** Automated cursor-based detection → markers.json
- **Key Classes:**
  - `CursorDetector` — Orchestrator, validates output
  - `ClickZoomGenerator` — Click event → zoom marker (500ms lead, 1500ms trail, 1.8x scale)
  - `DwellAnalyzer` — Cursor clusters (>1.5s, 50px radius) → highlight marker
  - `SceneBoundaryDetector` — Pause events → scene breaks
- **Key Files:**
  - `cursor-detector.ts` — Main orchestrator + Zod validation
  - `click-zoom-generator.ts` — Click → zoom (merges overlapping)
  - `dwell-analyzer.ts` — Stationary cursor → highlight
  - `detection-types.ts` — Zod schemas (ZoomMarker, HighlightMarker, ClickMarker, MarkersFile)
- **Inputs:** events.json
- **Outputs:** markers.json (click zooms, dwell highlights, click highlight dots)
- **CLI:** `detect --events <path> [--output <path>]`

#### 5. Orchestrator (`src/orchestrator/`)
- **Purpose:** Coordinate legacy auto pipeline (AI Director → Capture → Compositor → Export)
- **Core Class:** `PipelineCoordinator` (pipeline-coordinator.ts)
- **Key Files:**
  - `pipeline-coordinator.ts` — Phase A–E sequencing
  - `checkpoint-manager.ts` — Save/restore state for resume
  - `error-handler.ts` — Structured error logging
  - `types.ts` — Shared phase types
- **Responsibilities:**
  - Execute legacy auto pipeline only
  - Manage checkpoints for fault tolerance
  - Coordinate data flow between phases
  - Handle graceful shutdown
- **NOT used by:** Tutorial, clips, or compose pipelines

#### 6. AI Director (`src/ai-director/`)
- **Purpose:** [LEGACY] Scene analysis + script generation via Claude Vision
- **Key Files:**
  - `screenshot-analyzer.ts` — Claude Vision analysis
  - `script-generator.ts` — Vision analysis → narration
  - `click-plan-builder.ts` — Narration → click sequence
  - `prompts.ts` — Claude prompt templates
  - `types.ts` — DirectorConfig, ClickPlan
- **Dependencies:** Anthropic SDK, Playwright
- **Outputs:** click_plan.json, script.txt
- **Used by:** Legacy auto pipeline only

#### 7. Voice (`src/voice/`)
- **Purpose:** ElevenLabs TTS with character-level timestamp alignment (via with-timestamps endpoint)
- **Key Classes:**
  - `ElevenLabsClient` — TTS API wrapper with character-level timestamp extraction
  - `VoicePipeline` — Orchestrate TTS + subtitle timing
- **Key Files:**
  - `elevenlabs-client.ts` — TTS with `textToSpeechWithTimestamps()` method (uses with-timestamps endpoint)
  - `voice-pipeline.ts` — Generate voice + map character timestamps to words
  - `types.ts` — VoiceConfig, WordTimestamp
- **Key Method:** `textToSpeechWithTimestamps(text, voiceId)` → { audioBase64, characterTimestamps[] }
- **Dependencies:** ElevenLabs API (with-timestamps endpoint)
- **Outputs:** audio.mp3 (mp3_44100_128 format), character-level timestamps aligned to words
- **Used by:** Tutorial, clips, compose, and legacy auto pipelines
- **Note:** Replaces WhisperX (Python dependency) with native ElevenLabs integration

#### 8. Compositor (`src/compositor/`)
- **Purpose:** Remotion-based video composition for all pipelines
- **Key Classes:**
  - `RenderEngine` — Invoke Remotion renderer
  - `BrandLoader` — Load brand config (colors, fonts, logo)
  - `SceneTimingMapper` — [Legacy] Auto pipeline timing
  - `MarkerToRenderProps` — [Tutorial] Convert markers.json → Remotion props
- **Key Files:**
  - `render-engine.ts` — Remotion bundler + renderer invocation
  - `brand-loader.ts` — Parse brand.json
  - `scene-timing-mapper.ts` — Auto pipeline timing calculation
  - `marker-to-render-props.ts` — Tutorial pipeline: markers.json → Remotion props
  - `types.ts` — Shared types: BrandConfig, DEFAULT_INTRO_FRAMES=90, DEFAULT_OUTRO_FRAMES=120
- **Dependencies:** @remotion/bundler, @remotion/renderer, React
- **Outputs:** draft.mp4, Remotion composition

#### 9. Clips (`src/clips/`)
- **Purpose:** Reusable action clip library for compose pipeline
- **Key Files:**
  - `types.ts` — ClipMetadata, ClipRecording, ComposeManifest
  - `catalog-manager.ts` — CRUD clip catalog (data/clips/catalog.json)
  - `clip-recorder.ts` — Record single action clip via Playwright
  - `compose-pipeline.ts` — Clips + voice → render
  - `compose-metadata-builder.ts` — Build capture_metadata from clips
- **Data:** `data/clips/catalog.json` stores clip metadata
- **Outputs:** Reusable clip recordings with metadata
- **CLI:** `record-clip --url <url> --action <desc> --type <type>`, `clips list/info/remove`, `compose --manifest`

#### 10. Integrations (`src/integrations/`)
- **Purpose:** External service clients (tree-id knowledge base, etc.)
- **Key Files:**
  - `tree-id-client.ts` — Fetch context from user's knowledge base
  - `types.ts` — TreeIdContext, TreeIdConfig
- **Used by:** Script generator (optional context enrichment)

#### 11. Export (`src/export/`)
- **Purpose:** FFmpeg-based final video encoding (HEVC with hardware acceleration)
- **Key Files:**
  - `ffmpeg-exporter.ts` — HEVC encoding command construction
  - `chapter-generator.ts` — YouTube chapter markers
  - `types.ts` — ExportConfig, ExportResult
- **Dependencies:** FFmpeg (binary)
- **Outputs:** final_1080p.mp4 (or final_720p.mp4 in preview mode)
- **Used by:** All pipelines (legacy, tutorial, clips, compose)

#### 12. Server (`src/server/`)
- **Purpose:** HTTP API + WebSocket backend for job queue dashboard
- **Key Files:**
  - `index.ts` — Hono server setup, CORS, static files
  - `routes-jobs.ts` — Job queue REST API
  - `websocket-hub.ts` — WebSocket client broadcast
  - `serve-command.ts` — "serve" subcommand handler
- **Dependencies:** Hono, ws
- **Routes:**
  - `GET /api/health`, `GET/POST /api/jobs`, `GET /api/jobs/:id`
  - `WS /ws` — Real-time progress broadcast
  - `GET *` — Serve React dashboard SPA
- **Authentication:** Localhost-only (no auth yet)

#### 13. Queue (`src/queue/`)
- **Purpose:** Job persistence and worker orchestration
- **Key Classes:**
  - `JobStore` — SQLite CRUD
  - `JobRunner` — Poll queue, spawn workers
  - `JobWorker` — Worker subprocess entry point
- **Key Files:**
  - `job-store.ts`, `job-runner.ts`, `job-worker.ts`, `types.ts`
- **Storage:** `.video-factory.db` (SQLite)
- **Used by:** "serve" command for background job processing

#### 14. Dashboard (`src/dashboard/`)
- **Purpose:** React web UI for job monitoring
- **Key Files:**
  - `src/api-client.ts` — API wrapper
  - `src/use-websocket.ts` — WebSocket hook
  - `vite.config.ts` — Vite build config
- **Framework:** React, Vite
- **Features:** Job list, real-time progress, status updates

#### 15. Utils (`src/utils/`)
- **Purpose:** Shared utilities (logging, retry, cleanup)
- **Key Files:**
  - `logger.ts` — Structured logging (`[PHASE][LEVEL] message`)
  - `retry.ts` — Exponential backoff
  - `cleanup.ts` — Temp file cleanup
- **Used by:** All modules

## Data Flow by Pipeline

### HUMAN-ASSISTED TUTORIAL PIPELINE (Primary)
```
Step 1: SCRIPT GENERATION (LLM)
  URL + Purpose [+ tree-id context]
        ↓
  [Claude LLM]
        ↓
  script.json (scene descriptions + narration)

Step 2: HUMAN RECORDING + EVENT CAPTURE
  script.json + URL
        ↓
  [Human records screen + Playwright tracks events]
  [Overlay panel shows current step]
        ↓
  recording.webm + events.json (cursor, clicks, keys with timestamps)

Step 3: CURSOR-BASED DETECTION
  events.json
        ↓
  [ClickZoomGenerator] + [DwellAnalyzer] + [SceneBoundaryDetector]
        ↓
  markers.json (ZoomMarkers, HighlightMarkers, ClickMarkers, scene bounds)

Step 4: RENDER PREPARATION
  script.json + markers.json → MarkerToRenderProps
        ↓
  Remotion props (layout, timing, animations)

Step 5: VOICE + RENDERING
  narration text
        ↓
  [ElevenLabs textToSpeechWithTimestamps]
        ↓
  audio.mp3 + word-level timestamps
        ↓
  [Remotion Composition with Remotion props]
        ↓
  draft.mp4

Step 6: EXPORT
  draft.mp4 → [FFmpeg HEVC] → final_1080p.mp4
```

**Key Data Structures:**
- `events.json`: [{ type: "cursor"|"click"|"key", x, y, t }]
- `markers.json`: { zooms[], highlights[], clicks[], sceneBounds[] } (all with timing + region)
- Remotion props: { totalDurationFrames, intro, scenes[], outro }

### LEGACY AUTO PIPELINE
```
URL + Feature
       ↓
  [Phase A: AI Director]
  Screenshot → Claude Vision → script.txt + click_plan.json
       ↓
  [Phase B: Capture]
  click_plan.json → Playwright auto-execute → recording.webm
       ↓
  [Phase C: Convert]
  recording.webm → [FFmpeg] → video.mp4
       ↓
  [Phase D: Compositor]
  SceneTimingMapper → recording.mp4 + script.txt → draft.mp4
       ↓
  [Phase E: Export]
  draft.mp4 → [FFmpeg HEVC] → final_1080p.mp4
```

**Note:** Uses `SceneTimingMapper` instead of `MarkerToRenderProps`; captures are pre-analyzed by AI Director, not human-guided.

### CLIPS COMPOSE PIPELINE
```
[Record] → [Clips Catalog]
  URL + action → Playwright recording → clip_recording.json
                                              ↓
                      [Clips CRUD: list, info, remove]
                                              ↓
[Compose]
  compose.json (clips[] + narration)
       ↓
  [Load clips from catalog] + [ElevenLabs TTS] + [Build capture_metadata]
       ↓
  [Remotion Composition] → draft.mp4
       ↓
  [FFmpeg HEVC] → final_1080p.mp4
```

**Note:** Reuses tutorial rendering layer; clips are standalone recordings with metadata.

## Configuration & Environment

### CLI Commands & Config

**Primary Command:** `video-factory tutorial` (human-assisted pipeline)
```bash
video-factory tutorial --url <url> --script <path> [--output <path>]
```

**Generation & Detection:**
```bash
video-factory generate-script --url <url> --purpose <text> [--tree-id <id>] [--output <path>]
video-factory record --url <url> --script <path> [--output <path>]
video-factory detect --events <path> [--output <path>]
```

**Clips Pipeline:**
```bash
video-factory record-clip --url <url> --action <desc> --type <type> [--output <path>]
video-factory clips list [--format json]
video-factory clips info <clip-id>
video-factory clips remove <clip-id>
video-factory compose --manifest <path> [--output <path>]
```

**Legacy Auto Pipeline:**
```bash
video-factory run --url <url> --feature <text> [options]
```

**Server:**
```bash
video-factory serve [--port 3456]
```

**Help:**
```bash
video-factory --help       # List all 8 subcommands
video-factory <cmd> --help # Help for specific command
```

### Environment Variables
```
ANTHROPIC_API_KEY=sk-...          (required for script generation)
ELEVENLABS_API_KEY=...            (required for voice TTS)
VIEWPORT_WIDTH=1920                (default, Playwright)
VIEWPORT_HEIGHT=1080               (default, Playwright)
SCENE_RECORDING_FPS=30             (default)
PAGE_LOAD_TIMEOUT_MS=30000         (default)
ELEVENLABS_VOICE_ID=...            (default: "EXAVITQu4EmSK1z)
```

Load from `.env.local` (precedence) or `.env`.

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

### Timing & Duration Constants (src/compositor/types.ts)
```typescript
DEFAULT_INTRO_FRAMES = 90     // Intro sequence duration
DEFAULT_OUTRO_FRAMES = 120    // Outro sequence duration
SCENE_FRAME_RATE = 30         // Render FPS (matches capture)
```

### Remotion Props Schema (remotion/src/universal-template/props-schema.ts)
```typescript
{
  totalDurationFrames: number;
  intro: { tagline: string; duration: number };
  scenes: SceneProps[];
  outro: { cta: string; url: string; duration: number };
  markers: {
    zooms: ZoomMarker[];
    highlights: HighlightMarker[];
    clicks: ClickMarker[];
  };
  audio: { path: string; wordTimestamps: WordTimestamp[] };
}
```

### Remotion Component Layer Stack (remotion/src/universal-template/universal-composition.tsx)
1. **ContinuousScreen** — Background screen recording
2. **ZoomContainer** — Smooth pan/zoom animations (spring-based)
3. **ClickHighlight** — Cursor dot + dual ripple rings + glow
4. **RegionHighlight** — Frosted glass rectangle highlighting UI regions
5. **KaraokeSubtitles** — Word-level sync, scale + glow on active word
6. **IntroSequence** — Animated text overlay (beginning)
7. **OutroSequence** — CTA card + social links (end)
8. **ProgressBar** — Video timeline indicator

## Error Handling & Resilience

### Error Categories
1. **Validation Errors** — Missing args, invalid config
2. **API Errors** — Anthropic/ElevenLabs failures
3. **Browser Errors** — Playwright navigation, page load timeouts
4. **Filesystem Errors** — Missing files, write permissions
5. **Rendering Errors** — Remotion/FFmpeg failures

### Retry Strategy
- CLI dependencies (ffmpeg, node): single check, fail fast
- Browser operations: exponential backoff (configurable attempts)
- API calls: built-in retry via SDK
- Graceful degradation: continue if optional features fail (e.g., tree-id enrichment)

### Logging
- Structured logs (`[PHASE][LEVEL] message`) to `{output}/pipeline.log`
- Console output with phase summaries
- Error stack traces in logs only (not console)

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

## File Structure

```
src/
├── ai-director/        [LEGACY] Vision-based script + click plan
├── capture/            [LEGACY + Recorder] Browser recording
├── cli/                [Entry point, all subcommands]
├── clips/              [Clips library: record, catalog, compose]
├── compositor/         [Remotion rendering: timing, brand, markers]
├── dashboard/          [React UI for job queue]
├── detection/          [Tutorial: cursor→markers pipeline]
├── export/             [FFmpeg HEVC encoding + chapters]
├── integrations/       [tree-id client, external services]
├── orchestrator/       [LEGACY] Auto pipeline coordination
├── queue/              [Job persistence + worker threads]
├── recorder/           [Tutorial: human recording + event capture]
├── script/             [Tutorial: LLM-powered script generation]
├── server/             [HTTP API + WebSocket]
├── utils/              [Logging, retry, cleanup]
└── voice/              [ElevenLabs TTS + timestamps]

remotion/src/
├── components/         [ContinuousScreen, ZoomContainer, Highlights, etc.]
├── lib/                [Timing calculations, utilities]
├── universal-template/ [Main composition + props schema]
└── ...
```

## Key Design Patterns

1. **Pipeline Isolation** — Auto, tutorial, clips pipelines are independent but share rendering layer
2. **Marker Contract** — `markers.json` decouples detection from rendering
3. **Composition Pattern** — Remotion stacked layers (screen + zoom + highlights + subtitles + overlays)
4. **Event-Driven Detection** — Cursor events → zooms/highlights (deterministic, no AI vision)
5. **Checkpoint Pattern** — [LEGACY] Save state for resumption mid-pipeline
6. **Client-Server Pattern** — Hono API + React frontend for job queue
7. **Worker Thread Pattern** — Job processing in isolated child processes
8. **Type Safety** — TypeScript strict mode + Zod schemas throughout

## Integration Points

- **CLI ↔ Subcommands:** Each pipeline has entry command (tutorial, record-clip, etc.)
- **Detection ↔ Render:** `markers.json` file contract (detection output → render input)
- **Voice ↔ Render:** Timestamps embedded in Remotion props
- **Render ↔ Export:** draft.mp4 intermediate (render output → export input)
- **Server ↔ Dashboard:** REST API + WebSocket for real-time job progress
- **All Pipelines ↔ Storage:** Output directory structure (script.json, events.json, markers.json, audio.mp3, final_1080p.mp4)

