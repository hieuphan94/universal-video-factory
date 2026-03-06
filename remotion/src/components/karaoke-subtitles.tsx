import React from "react";
import { useCurrentFrame, interpolate } from "remotion";
import { findCurrentWordIndex } from "../lib/timing-calculator";
import type { WordProps } from "../universal-template/props-schema";

interface KaraokeSubtitlesProps {
  words: WordProps[];
  width: number;
  height: number;
}

// Number of words to display in the visible subtitle line
const CONTEXT_WORDS = 7;
// Frames for the active word scale/color transition
const TRANSITION_FRAMES = 4;

/**
 * Karaoke-style subtitle renderer.
 * Shows a sliding window of words around the current word.
 * Active word gets scale bump + accent color with smooth transitions.
 * Frosted glass pill background for readability over any content.
 */
export const KaraokeSubtitles: React.FC<KaraokeSubtitlesProps> = ({
  words,
  width,
  height,
}) => {
  const frame = useCurrentFrame();

  if (words.length === 0) return null;

  const currentIdx = findCurrentWordIndex(words, frame);
  if (currentIdx < 0) return null;

  // Sliding window: center current word in view
  const half = Math.floor(CONTEXT_WORDS / 2);
  const windowStart = Math.max(0, currentIdx - half);
  const windowEnd = Math.min(words.length, windowStart + CONTEXT_WORDS);
  const visibleWords = words.slice(windowStart, windowEnd);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 60,
        left: 0,
        width,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "baseline",
          gap: "0 10px",
          // Frosted glass pill
          backgroundColor: "rgba(0, 0, 0, 0.75)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderRadius: 16,
          padding: "14px 28px",
          maxWidth: width * 0.8,
          // Subtle border for depth
          border: "1px solid rgba(255, 255, 255, 0.08)",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
        }}
      >
        {visibleWords.map((w, i) => {
          const globalIdx = windowStart + i;
          const isActive = globalIdx === currentIdx;

          // Smooth transition: interpolate based on distance from word's start frame
          const wordStart = w.startFrame;
          const activeFactor = isActive
            ? interpolate(
                frame,
                [wordStart, wordStart + TRANSITION_FRAMES],
                [0, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
              )
            : 0;

          // Scale bump on active word (1.0 → 1.12)
          const scale = 1.0 + activeFactor * 0.12;
          // Color: white → gold
          const r = Math.round(255);
          const g = Math.round(255 - activeFactor * 40); // 255 → 215
          const b = Math.round(255 - activeFactor * 255); // 255 → 0
          const fontWeight = isActive ? 700 : 400;

          return (
            <span
              key={`${globalIdx}-${w.word}`}
              style={{
                fontSize: 40,
                fontFamily:
                  "'Inter', 'SF Pro Display', system-ui, -apple-system, sans-serif",
                fontWeight,
                color: `rgb(${r}, ${g}, ${b})`,
                textShadow: isActive
                  ? "0 0 12px rgba(255, 215, 0, 0.5), 0 2px 4px rgba(0,0,0,0.8)"
                  : "0 1px 3px rgba(0,0,0,0.9)",
                lineHeight: 1.5,
                transform: `scale(${scale})`,
                transformOrigin: "center bottom",
                transition: "font-weight 0.1s ease",
              }}
            >
              {w.word}
            </span>
          );
        })}
      </div>
    </div>
  );
};
