import React from "react";
import { Composition } from "remotion";
import { UniversalComposition } from "./universal-template/universal-composition";
import { UniversalTemplatePropsSchema } from "./universal-template/props-schema";

// Default props used in Remotion Studio preview
const defaultProps = {
  scenes: [
    {
      id: "scene-01",
      videoPath: "https://www.w3schools.com/html/mov_bbb.mp4",
      startFrame: 0,
      durationFrames: 150,
    },
  ],
  audioPath: "",
  words: [
    { word: "Hello", startFrame: 0, endFrame: 30 },
    { word: "world", startFrame: 31, endFrame: 60 },
    { word: "this", startFrame: 61, endFrame: 90 },
    { word: "is", startFrame: 91, endFrame: 110 },
    { word: "a", startFrame: 111, endFrame: 120 },
    { word: "test", startFrame: 121, endFrame: 150 },
  ],
  fps: 30,
  width: 1920,
  height: 1080,
  totalDurationFrames: 150,
  // Phase 4 visual effects — empty defaults for Studio preview
  brand: undefined,
  clicks: [],
  zoomEvents: [],
  introDuration: 90,
  outroDuration: 120,
  cta: undefined,
  // Phase 5 PiP overlays — empty default for Studio preview
  steps: [],
};

/**
 * Root registers all Remotion compositions.
 * UniversalTemplate is the primary composition for tutorial videos.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="UniversalTemplate"
      component={UniversalComposition}
      durationInFrames={defaultProps.totalDurationFrames}
      fps={defaultProps.fps}
      width={defaultProps.width}
      height={defaultProps.height}
      schema={UniversalTemplatePropsSchema}
      defaultProps={defaultProps}
      calculateMetadata={async ({ props }) => ({
        // Total = intro + content + outro (totalDurationFrames is content only)
        durationInFrames: props.totalDurationFrames + props.introDuration + props.outroDuration,
        fps: props.fps,
        width: props.width,
        height: props.height,
      })}
    />
  );
};
