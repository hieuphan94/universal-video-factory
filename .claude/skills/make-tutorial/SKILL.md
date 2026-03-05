# Make Tutorial Video

Generate a polished 1080p tutorial video from a URL and feature description using `video-factory`.

## Prerequisites

- `ANTHROPIC_API_KEY` — set in `.env.local` (Claude Vision for screenshot analysis)
- `ELEVENLABS_API_KEY` — set in `.env.local` (text-to-speech narration)
- `ffmpeg` with VideoToolbox — `brew install ffmpeg`
- `node` 20+ — `brew install node`
- `python` 3.10+ with WhisperX — `pip install whisperx` (for word-level timestamps)
- `playwright` browsers — `npx playwright install chromium`

## Basic Usage

```bash
npx video-factory --url=https://app.example.com --feature="create new project"
```

## All Options

```
--url        Target web app URL (required)
--feature    Feature to demonstrate, e.g. "sign up flow" (required)
--lang       Narration language code, e.g. en, vi, ja (default: en)
--brand      Path to brand.json for custom colors/logo/fonts
--voice      Path to voice config JSON (ElevenLabs voice ID + settings)
--cookies    Path to cookies JSON for authenticated sessions
--manual     Open browser for manual recording — press Enter when done
--output     Output directory (default: ./output)
--resume     Resume pipeline from last checkpoint
--preview    Render at 720p for faster preview iteration
--verbose    Enable debug-level log output
```

## Examples

```bash
# Basic — public URL, English narration
npx video-factory \
  --url=https://example.com \
  --feature="sign up"

# Authenticated flow with cookies
npx video-factory \
  --url=https://app.example.com \
  --feature="checkout flow" \
  --cookies=./session.json \
  --output=./my-video

# Custom brand + Vietnamese narration
npx video-factory \
  --url=https://app.example.com \
  --feature="tạo dự án mới" \
  --lang=vi \
  --brand=./brand/my-brand.json \
  --output=./output-vi

# Quick 720p preview
npx video-factory \
  --url=https://app.example.com \
  --feature="onboarding" \
  --preview \
  --output=./preview-out

# Manual recording (complex interactions)
npx video-factory \
  --url=https://app.example.com \
  --feature="drag and drop reorder" \
  --manual \
  --output=./manual-out

# Resume after interruption
npx video-factory \
  --url=https://app.example.com \
  --feature="create project" \
  --output=./output \
  --resume
```

## brand.json Format

```json
{
  "name": "My Company",
  "logo": "./assets/logo.png",
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

## cookies.json Format

Export from browser DevTools → Application → Cookies, or use:

```bash
# Using playwright to export session
npx playwright codegen --save-storage=./session.json https://app.example.com
```

## Output Structure

```
./output/
├── final_1080p.mp4        — finished tutorial video
├── draft.mp4              — pre-export Remotion render
├── script.txt             — generated narration script
├── click_plan.json        — AI-generated interaction plan
├── capture_metadata.json  — scene timing metadata
├── words_timestamps.json  — word-level audio timestamps
├── pipeline.log           — full debug log
├── scenes/                — recorded scene clips (.mp4)
└── audio/                 — generated TTS audio
```

## Pipeline Phases

| Phase | Description                         | Key Output           |
|-------|-------------------------------------|----------------------|
| A     | Screenshot → Claude Vision → Script | script.txt, click_plan.json |
| B     | Playwright capture → scene videos   | scenes/*.mp4         |
| C     | Convert .webm → .mp4                | scenes/*.mp4 (h264)  |
| D     | Remotion compositor → draft         | draft.mp4            |
| E     | FFmpeg HEVC export → final          | final_1080p.mp4      |

## Error Troubleshooting

| Error | Fix |
|-------|-----|
| `ANTHROPIC_API_KEY is not set` | Add `ANTHROPIC_API_KEY=sk-...` to `.env.local` |
| `ELEVENLABS_API_KEY is not set` | Add `ELEVENLABS_API_KEY=...` to `.env.local` |
| `FFmpeg not found` | `brew install ffmpeg` |
| `WhisperX service unavailable` | Start WhisperX: `python -m whisperx.server` |
| Pipeline interrupted mid-run | Re-run with `--resume` to continue from checkpoint |
