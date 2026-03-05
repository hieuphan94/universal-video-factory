import React from "react";
import { OffthreadVideo } from "remotion";

interface ContinuousScreenProps {
  /** Path to the single continuous recording video */
  videoPath: string;
  width: number;
  height: number;
}

/**
 * Renders the continuous screen recording as a single uninterrupted video.
 * No scene cuts — the video plays straight through for the entire content duration.
 * Scene boundaries are handled by overlay layers (subtitles, step counter, etc).
 */
export const ContinuousScreen: React.FC<ContinuousScreenProps> = ({
  videoPath,
  width,
  height,
}) => {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        overflow: "hidden",
        backgroundColor: "#000",
      }}
    >
      <OffthreadVideo
        src={videoPath}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
        }}
      />
    </div>
  );
};
