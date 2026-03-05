import React from "react";
import { useCurrentFrame, interpolate } from "remotion";

type AnimationMode = "typewriter" | "fade-words" | "slide-up";

interface AnimatedTextProps {
  text: string;
  mode: AnimationMode;
  // Frame window within which the full animation plays out
  startFrame: number;
  endFrame: number;
  style?: React.CSSProperties;
  charStyle?: React.CSSProperties;
}

// Typewriter: characters appear one by one across the frame window
const TypewriterText: React.FC<{
  text: string;
  startFrame: number;
  endFrame: number;
  style?: React.CSSProperties;
}> = ({ text, startFrame, endFrame, style }) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [startFrame, endFrame], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const visibleChars = Math.floor(progress * text.length);

  return (
    <span style={style}>
      {text.split("").map((char, i) => (
        <span
          key={i}
          style={{ opacity: i < visibleChars ? 1 : 0 }}
        >
          {char}
        </span>
      ))}
    </span>
  );
};

// Fade-words: each word fades in sequentially across the frame window
const FadeWordsText: React.FC<{
  text: string;
  startFrame: number;
  endFrame: number;
  style?: React.CSSProperties;
}> = ({ text, startFrame, endFrame, style }) => {
  const frame = useCurrentFrame();
  const words = text.split(" ");
  const totalFrames = endFrame - startFrame;
  // Each word gets an equal slice; fade takes 8 frames
  const slicePerWord = totalFrames / words.length;
  const fadeDuration = Math.min(8, slicePerWord);

  return (
    <span style={{ ...style, display: "inline" }}>
      {words.map((word, i) => {
        const wordStart = startFrame + i * slicePerWord;
        const opacity = interpolate(
          frame,
          [wordStart, wordStart + fadeDuration],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );
        return (
          <span key={i} style={{ opacity, marginRight: "0.3em" }}>
            {word}
          </span>
        );
      })}
    </span>
  );
};

// Slide-up: words slide up from below with staggered entrance
const SlideUpText: React.FC<{
  text: string;
  startFrame: number;
  endFrame: number;
  style?: React.CSSProperties;
}> = ({ text, startFrame, endFrame, style }) => {
  const frame = useCurrentFrame();
  const words = text.split(" ");
  const totalFrames = endFrame - startFrame;
  const stagger = Math.min(6, totalFrames / words.length);
  const slideDuration = Math.min(12, totalFrames);

  return (
    <span style={{ ...style, display: "inline", overflow: "hidden" }}>
      {words.map((word, i) => {
        const wordStart = startFrame + i * stagger;
        const progress = interpolate(
          frame,
          [wordStart, wordStart + slideDuration],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );
        const translateY = (1 - progress) * 30;
        const opacity = progress;
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              opacity,
              transform: `translateY(${translateY}px)`,
              marginRight: "0.3em",
            }}
          >
            {word}
          </span>
        );
      })}
    </span>
  );
};

export const AnimatedText: React.FC<AnimatedTextProps> = ({
  text,
  mode,
  startFrame,
  endFrame,
  style,
}) => {
  if (mode === "typewriter") {
    return (
      <TypewriterText
        text={text}
        startFrame={startFrame}
        endFrame={endFrame}
        style={style}
      />
    );
  }
  if (mode === "fade-words") {
    return (
      <FadeWordsText
        text={text}
        startFrame={startFrame}
        endFrame={endFrame}
        style={style}
      />
    );
  }
  return (
    <SlideUpText
      text={text}
      startFrame={startFrame}
      endFrame={endFrame}
      style={style}
    />
  );
};
