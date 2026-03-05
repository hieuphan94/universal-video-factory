# Video Factory - Project Overview & Product Development Requirements

## Project Definition

**Name:** Video Factory
**Type:** CLI + Web Dashboard tool
**Primary Goal:** Auto-generate polished 1080p tutorial videos from a URL + feature description with zero manual editing.

### What It Does
Takes a web app URL and feature description → produces a complete tutorial video in ~13-15 minutes:
- AI-directed screenshot analysis
- Automated interaction recording (clicks, navigation)
- AI-generated voiceover script
- Video composition with karaoke subtitles
- Final 1080p export via FFmpeg Metal

### Target Users
- Product teams needing demo/tutorial videos
- Developers documenting features
- Marketing teams creating onboarding content
- SaaS companies scaling video production

## Core Capabilities

| Capability | Description | Technology |
|------------|-------------|-----------|
| **DOM Analysis** | Identify interactive elements on page | Claude Vision + Playwright |
| **Script Generation** | AI-created narration script for feature flow | Claude Sonnet 4.6 |
| **Automated Recording** | Playwright-driven interaction capture | Playwright browser API |
| **Voice Synthesis** | Natural TTS narration | ElevenLabs API |
| **Subtitle Sync** | Karaoke-style subs with forced alignment | WhisperX (±0.05s precision) |
| **Composition** | Multi-layer video assembly | Remotion (React-based) |
| **Export** | Hardware-accelerated 1080p HEVC | FFmpeg VideoToolbox Metal |
| **Web Dashboard** | Job queue + real-time progress UI | Hono API + React + WebSocket |

## Key Features

1. **Multi-language Support** — Generate narration in any language (defaults to English)
2. **Brand Customization** — Custom colors, logo, fonts, intro/outro animations
3. **Session Authentication** — Cookie-based login for protected apps
4. **Manual Mode** — Pause recording for complex interactions
5. **Resume Checkpoints** — Resume pipeline from last completed phase
6. **Preview Mode** — 720p rendering for faster iteration
7. **Real-time Monitoring** — WebSocket-driven progress dashboard

## Technical Constraints

| Constraint | Value | Rationale |
|-----------|-------|-----------|
| **Max viewport** | 1920x1080 | Remotion composition limits |
| **Recording FPS** | 30 fps | Smooth motion at reasonable file size |
| **Audio alignment** | ±0.05s | WhisperX forced alignment precision |
| **Max pipeline time** | ~15 min | M4 24GB performance baseline |
| **Estimated cost** | ~$0.67/video | Claude + ElevenLabs API usage |

## Non-Functional Requirements

### Performance
- CLI startup: < 2 seconds
- Screenshot analysis: < 30 seconds
- Full video generation: 13–15 minutes (M4 24GB)
- Dashboard response: < 100ms

### Reliability
- Checkpoint-based resumption after failures
- Structured error handling with retry logic
- Graceful fallback to Stagehand when DOM analysis fails
- Complete audit logs in pipeline.log

### Security
- No secrets in git (`.env.local` not committed)
- API keys validated at startup
- SQLite job queue stored locally
- WebSocket communication on localhost only

### Scalability
- Single-node dashboard (queue-based job processing)
- Worker threads for long-running tasks
- Configurable concurrency settings
- Supports queueing multiple jobs sequentially

## Success Criteria

1. **Video Quality** — Polished output indistinguishable from manual production
2. **Latency** — Complete tutorial video in < 20 minutes on standard hardware
3. **Accuracy** — Script reflects actual feature flow (verified by spot checks)
4. **Cost Efficiency** — ~$0.67/video via API usage
5. **Reliability** — 95%+ success rate without manual intervention
6. **Usability** — Zero required manual editing; works via CLI or web dashboard

## API Cost Breakdown (per video)
- Claude Vision analysis: ~$0.30
- Claude script generation: ~$0.20
- ElevenLabs TTS: ~$0.15
- Anthropic/ElevenLabs overhead: ~$0.02
- **Total:** ~$0.67

## Future Roadmap

### Phase 1 (Current)
- Core CLI pipeline (A–E phases)
- Basic web dashboard with job queue
- Single-language support (English)

### Phase 2 (Planned)
- Multi-language narration (auto-translation)
- Advanced brand templates
- A/B testing framework
- Analytics dashboard

### Phase 3 (Research)
- Video editing recommendations (trim/enhance)
- Subtitle customization UI
- Automated quality scoring
- Integration with video hosting platforms

## Development Status

| Component | Status | Notes |
|-----------|--------|-------|
| CLI Core | Complete | All 5 phases functional |
| Web Dashboard | Complete | Jobs API + React UI |
| Database Queue | Complete | SQLite job store + worker threads |
| Testing | Partial | Unit tests for utilities; integration tests in progress |
| Documentation | In Progress | Architecture + API docs needed |

## Dependencies
- **Runtime:** Node.js 20+, FFmpeg, Python 3.10+ (WhisperX)
- **APIs:** Anthropic, ElevenLabs
- **Libraries:** Playwright, Remotion, Hono, React, SQLite

## Acceptance Criteria
- [ ] CLI generates complete 1080p video from URL + feature
- [ ] Dashboard displays job queue with real-time progress
- [ ] All 5 pipeline phases execute with checkpoints
- [ ] Video output matches quality standards
- [ ] Error recovery via resume works end-to-end
- [ ] Documentation covers all user-facing APIs
