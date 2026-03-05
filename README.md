# Video Factory

CLI tool that auto-generates polished 1080p tutorial videos from a URL + feature description. Zero manual editing.

```bash
video-factory --url=https://app.example.com --feature="create new project"
```

## How It Works

```
INPUT: --url + --feature + --lang

Phase A — AI Director (Claude Vision)
  Screenshot → element analysis → narration script + click plan

Phase B — Capture (Playwright)
  Execute click plan → record each scene as video

Phase C — Convert
  .webm → .mp4 (h264) for Remotion compatibility

Phase D — Compositor (Remotion)
  Scenes + voiceover + karaoke subs + effects → draft.mp4

Phase E — Export (FFmpeg)
  VideoToolbox HEVC Metal → final_1080p.mp4
```

**Pipeline time:** ~13-15 min/video on M4 24GB | **Cost:** ~$5.40/month (8 videos)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| DOM Discovery | Playwright + Claude Vision + Stagehand |
| Script Generation | Claude API (claude-sonnet-4-6) |
| Voice TTS | ElevenLabs API |
| Subtitles | WhisperX (forced alignment ±0.05s) |
| Compositor | Remotion (React-based video) |
| Export | FFmpeg VideoToolbox (Metal HEVC) |

## Prerequisites

- **Node.js** 20+ — `brew install node`
- **FFmpeg** with VideoToolbox — `brew install ffmpeg`
- **Python** 3.10+ with WhisperX — `pip install whisperx`
- **Playwright** browsers — `npx playwright install chromium`
- **API Keys** in `.env.local`:
  ```
  ANTHROPIC_API_KEY=sk-...
  ELEVENLABS_API_KEY=...
  ```

## Installation

```bash
git clone https://github.com/hieuspaceos/universal-video-factory.git
cd universal-video-factory
npm install
npm run build
```

## Usage

```bash
# Basic — public URL, English narration
video-factory --url=https://example.com --feature="sign up"

# Authenticated flow with cookies
video-factory --url=https://app.example.com --feature="checkout" --cookies=./session.json

# Custom brand + Vietnamese narration
video-factory --url=https://app.example.com --feature="tao du an moi" --lang=vi --brand=./brand/my-brand.json

# Quick 720p preview
video-factory --url=https://app.example.com --feature="onboarding" --preview

# Manual recording (complex interactions)
video-factory --url=https://app.example.com --feature="drag and drop" --manual

# Resume after interruption
video-factory --url=https://app.example.com --feature="create project" --resume
```

## CLI Options

```
--url        Target web app URL (required)
--feature    Feature to demonstrate (required)
--lang       Narration language code (default: en)
--brand      Path to brand.json for custom colors/logo/fonts
--voice      Path to voice config JSON (ElevenLabs voice ID)
--cookies    Path to cookies JSON for authenticated sessions
--manual     Open browser for manual recording mode
--output     Output directory (default: ./output)
--resume     Resume pipeline from last checkpoint
--preview    Render at 720p for faster iteration
--verbose    Enable debug-level log output
```

## Output Structure

```
./output/
├── final_1080p.mp4        — finished tutorial video
├── draft.mp4              — pre-export Remotion render
├── script.txt             — generated narration script
├── click_plan.json        — AI-generated interaction plan
├── capture_metadata.json  — scene timing metadata
├── pipeline.log           — full debug log
├── scenes/                — recorded scene clips
└── audio/                 — generated TTS audio
```

## Brand Customization

Create a `brand.json` to customize video appearance:

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
  "outro": { "cta": "Try it free", "url": "https://myapp.com", "duration": 4 }
}
```

## Video Components

- **Screen recording** with cursor tracking
- **Voiceover** with karaoke-style subtitles
- **Click highlight** — animated SVG ring at click coordinates
- **Zoom** — spring animation zoom to click point
- **Intro/Outro** — brand-driven animations
- **Progress bar** + step counter overlay

## Web Dashboard

A browser-based UI for managing video generation jobs with real-time progress.

```bash
# Start the dashboard server
video-factory serve --port=3456

# Development mode
npm run dev -- serve --port=3456
```

Open http://localhost:3456 to access the dashboard. Features:
- Create and manage video generation jobs
- Real-time pipeline progress via WebSocket
- Live log streaming
- Video preview for completed jobs

For dashboard UI development, run the Vite dev server alongside the API:

```bash
npm run dev -- serve          # API server on :3456
npm run dashboard:dev         # Vite dev server on :5173 (proxies to API)
```

## Project Structure

```
src/
├── ai-director/     — Claude Vision analysis, script generation, click planning
├── capture/         — Playwright browser recording, scene capture, manual mode
├── cli/             — CLI entry point, argument parsing, progress display
├── compositor/      — Brand loading, scene timing, Remotion render engine
├── dashboard/       — React web UI (Vite + TypeScript)
├── export/          — FFmpeg HEVC export, webm→mp4 conversion
├── orchestrator/    — Pipeline coordinator, checkpoints, error handling
├── queue/           — SQLite job store, runner, worker
├── server/          — Hono API server, WebSocket hub, job routes
└── utils/           — Retry, logger, cleanup utilities

remotion/src/
├── components/      — Click highlight, zoom, karaoke subs, intro/outro, PiP
└── universal-template/  — Main composition, props schema, scene sequencer

docs/                — Project documentation (architecture, code standards, etc.)
```

## Development

```bash
npm run dev          # Run CLI in development mode
npm run build        # Build CLI + dashboard
npm run typecheck    # TypeScript type checking
npm test             # Run unit tests
npm run test:watch   # Watch mode
npm run dashboard:dev    # Dashboard Vite dev server
npm run dashboard:build  # Build dashboard only
```

## Troubleshooting

| Error | Fix |
|-------|-----|
| `ANTHROPIC_API_KEY is not set` | Add to `.env.local` |
| `ELEVENLABS_API_KEY is not set` | Add to `.env.local` |
| `FFmpeg not found` | `brew install ffmpeg` |
| Pipeline interrupted | Re-run with `--resume` |

## License

MIT
