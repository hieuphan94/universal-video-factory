import React from "react";
import { useVideoConfig, Sequence } from "remotion";
import { ContinuousScreen } from "../components/screen-clip";
import { AudioLayer } from "../components/audio-layer";
import { KaraokeSubtitles } from "../components/karaoke-subtitles";
import { ClickHighlight } from "../components/click-highlight";
import { ZoomContainer } from "../components/zoom-container";
import { IntroSequence } from "../components/intro-sequence";
import { OutroSequence } from "../components/outro-sequence";
import { ProgressBar } from "../components/progress-bar";
import { StepCounter } from "../components/step-counter";
import { SceneTransition } from "../components/scene-transition";
import { MemeInsert } from "../components/meme-insert";
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
  cta,
  steps,
  transitions = [],
  memeInserts = [],
}) => {
  const { width, height, durationInFrames } = useVideoConfig();

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
          <ZoomContainer zoomEvents={zoomEvents}>
            <ContinuousScreen
              videoPath={continuousVideoPath}
              width={width}
              height={height}
            />
          </ZoomContainer>

          {/* Layer 4: Scene transitions — overlay per scene boundary */}
          {transitions
            .filter((t) => t.type !== "none" && t.durationFrames > 0)
            .map((t) => {
              const scene = scenes[t.sceneIndex];
              if (!scene) return null;
              return (
                <Sequence
                  key={`transition-${t.sceneIndex}`}
                  from={scene.startFrame}
                  durationInFrames={t.durationFrames}
                  name={`transition-${t.sceneIndex}`}
                >
                  <SceneTransition type={t.type} durationFrames={t.durationFrames}>
                    <div style={{ position: "absolute", inset: 0, backgroundColor: "#000" }} />
                  </SceneTransition>
                </Sequence>
              );
            })}

          {/* Layer 5: Click highlights — rendered above zoom for visibility */}
          {clicks.map((click, i) => (
            <ClickHighlight
              key={`click-${i}-${click.frame}`}
              x={click.x}
              y={click.y}
              startFrame={click.frame}
              size={40}
            />
          ))}

          {/* Layer 6: Meme/reaction inserts */}
          {memeInserts.map((meme, i) => {
            const scene = scenes[meme.sceneIndex];
            if (!scene) return null;
            const memeStart = scene.startFrame + meme.frameOffset;
            return (
              <Sequence
                key={`meme-${i}-${meme.sceneIndex}`}
                from={memeStart}
                durationInFrames={meme.durationFrames}
                name={`meme-${meme.sceneIndex}`}
              >
                <MemeInsert
                  src={meme.src}
                  mode={meme.mode}
                  durationFrames={meme.durationFrames}
                  position={meme.position}
                />
              </Sequence>
            );
          })}
        </Sequence>
      )}

      {/* Layer 5: Audio — spans full composition duration */}
      <AudioLayer audioPath={audioPath} />

      {/* Layer 6: Karaoke subtitles — fixed overlay, above everything */}
      <KaraokeSubtitles words={words} width={width} height={height} />

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
