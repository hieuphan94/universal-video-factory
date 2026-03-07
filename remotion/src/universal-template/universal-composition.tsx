import React from "react";
import { useVideoConfig, Sequence } from "remotion";
import { ContinuousScreen } from "../components/screen-clip";
import { AudioLayer } from "../components/audio-layer";
import { KaraokeSubtitles } from "../components/karaoke-subtitles";
import { ClickHighlight } from "../components/click-highlight";
import { ZoomContainer } from "../components/zoom-container";
import { IntroSequence } from "../components/intro-sequence";
import { OutroSequence } from "../components/outro-sequence";
import { RegionHighlight } from "../components/region-highlight";
import { ProgressBar } from "../components/progress-bar";
import { StepCounter } from "../components/step-counter";
import type { UniversalTemplateProps } from "./props-schema";

/**
 * Universal composition — full layer stack (bottom to top):
 *
 * 1. Black background
 * 2. Intro sequence  (frames 0 → introDuration)
 * 3. Zoom container  (frames introDuration → totalDurationFrames - outroDuration)
 *    └── Scene sequencer (screen recordings, offset by introDuration)
 * 4. Click highlights (overlay on content region, same offset)
 * 5. Audio layer      (full duration)
 * 6. Karaoke subtitles (full duration, word frames already offset externally)
 * 7. Outro sequence  (last outroDuration frames)
 */
export const UniversalComposition: React.FC<UniversalTemplateProps> = ({
  scenes,
  audioPath,
  words,
  brand,
  clicks,
  zoomEvents,
  introDuration,
  outroDuration,
  highlights = [],
  cursorTrail = [],
  cta,
  steps,
}) => {
  const { width, height, durationInFrames } = useVideoConfig();

  // Auto-generate per-scene zoom events centered on each scene's clicks.
  // Falls back to marker-provided zoom events when available.
  const effectiveZoomEvents = (() => {
    if (zoomEvents.length > 0) return zoomEvents;
    if (scenes.length < 2 || clicks.length === 0) return [];

    // Group clicks by scene (skip scene 0 = overview/intro)
    const actionScenes = scenes.slice(1);
    const generated: typeof zoomEvents = [];

    for (const scene of actionScenes) {
      const sceneEnd = scene.startFrame + scene.durationFrames;
      const sceneClicks = clicks.filter(
        (c) => c.frame >= scene.startFrame && c.frame < sceneEnd
      );
      if (sceneClicks.length === 0) continue;

      // Average click position as focus point for this scene
      const avgX = Math.round(
        sceneClicks.reduce((sum, c) => sum + c.x, 0) / sceneClicks.length
      );
      const avgY = Math.round(
        sceneClicks.reduce((sum, c) => sum + c.y, 0) / sceneClicks.length
      );
      // Hold for scene duration minus zoom-in/out transitions (15f each)
      const holdDuration = Math.max(1, scene.durationFrames - 30);

      generated.push({
        frame: scene.startFrame,
        x: avgX,
        y: avgY,
        scale: 1.35,
        duration: holdDuration,
      });
    }

    return generated;
  })();

  // Duration of the main content window (between intro and outro)
  const contentStart = introDuration;
  const contentEnd = durationInFrames - outroDuration;
  const contentDuration = Math.max(1, contentEnd - contentStart);

  // All scenes share one continuous video — use the first scene's videoPath
  const continuousVideoPath = scenes.length > 0 ? scenes[0].videoPath : "";

  // Feature title: derive from first scene id or fallback
  const featureTitle =
    scenes.length > 0
      ? scenes[0].id.replace(/[-_]/g, " ")
      : "Feature Walkthrough";

  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        backgroundColor: "#000",
        overflow: "hidden",
      }}
    >
      {/* Layer 1: Intro sequence */}
      {introDuration > 0 && (
        <Sequence from={0} durationInFrames={introDuration} name="intro">
          <IntroSequence
            brand={brand}
            featureTitle={featureTitle}
            duration={introDuration}
          />
        </Sequence>
      )}

      {/* Layer 2+3: Content — zoom wrapper + scene sequencer + transitions */}
      {contentDuration > 0 && (
        <Sequence
          from={contentStart}
          durationInFrames={contentDuration}
          name="content"
        >
          <ZoomContainer zoomEvents={effectiveZoomEvents} cursorTrail={cursorTrail}>
            <ContinuousScreen
              videoPath={continuousVideoPath}
              width={width}
              height={height}
              scenes={scenes}
            />
          </ZoomContainer>

          {/* Layer 4: Click highlights — rendered above zoom for visibility */}
          {clicks.map((click, i) => (
            <ClickHighlight
              key={`click-${i}-${click.frame}`}
              x={click.x}
              y={click.y}
              startFrame={click.frame}
              size={40}
            />
          ))}

          {/* Layer 4b: Region highlights — dwell area overlays */}
          {highlights.map((h, i) => (
            <RegionHighlight
              key={`highlight-${i}-${h.startFrame}`}
              x={h.x}
              y={h.y}
              w={h.w}
              h={h.h}
              startFrame={h.startFrame}
              durationFrames={h.durationFrames}
            />
          ))}

        </Sequence>
      )}

      {/* Layer 5: Audio — starts after intro, spans content + outro */}
      <Sequence from={contentStart} durationInFrames={durationInFrames - contentStart} name="audio">
        <AudioLayer audioPath={audioPath} />
      </Sequence>

      {/* Layer 6: Karaoke subtitles — fixed overlay, visible only during content */}
      <KaraokeSubtitles
        words={words}
        width={width}
        height={height}
        showAfterFrame={contentStart}
        hideAfterFrame={contentEnd}
      />

      {/* Layer 7: PiP overlays — progress bar + step counter (content region only) */}
      {scenes.length > 0 && contentDuration > 0 && (
        <Sequence from={contentStart} durationInFrames={contentDuration} name="pip">
          <ProgressBar
            scenes={scenes}
            color={brand?.colors.accent ?? "#FFD700"}
            height={4}
          />
          <StepCounter
            scenes={scenes.map((s, i) => ({
              id: steps[i]?.id ?? s.id,
              startFrame: s.startFrame,
              durationFrames: s.durationFrames,
            }))}
            position="top-right"
          />
        </Sequence>
      )}

      {/* Layer 8: Outro sequence */}
      {outroDuration > 0 && contentEnd > 0 && (
        <Sequence
          from={contentEnd}
          durationInFrames={outroDuration}
          name="outro"
        >
          <OutroSequence brand={brand} cta={cta} duration={outroDuration} />
        </Sequence>
      )}
    </div>
  );
};
