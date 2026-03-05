import React from "react";
import { useCurrentFrame } from "remotion";
import { findCurrentWordIndex } from "../lib/timing-calculator";
import type { WordProps } from "../universal-template/props-schema";

interface KaraokeSubtitlesProps {
  words: WordProps[];
  width: number;
  height: number;
}

// Number of words to display in the visible subtitle line
const CONTEXT_WORDS = 7;

/**
 * Karaoke-style subtitle renderer.
 * Shows a sliding window of words around the current word.
 * Highlights the active word bold + accent color.
 * Positioned bottom-center with a semi-transparent background bar.
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
          gap: "0 8px",
          backgroundColor: "rgba(0, 0, 0, 0.65)",
          borderRadius: 8,
          padding: "10px 20px",
          maxWidth: width * 0.85,
        }}
      >
        {visibleWords.map((w, i) => {
          const globalIdx = windowStart + i;
          const isActive = globalIdx === currentIdx;
          return (
            <span
              key={`${globalIdx}-${w.word}`}
              style={{
                fontSize: 38,
                fontFamily: "system-ui, -apple-system, sans-serif",
                fontWeight: isActive ? 700 : 400,
                color: isActive ? "#FFD700" : "#FFFFFF",
                textShadow: "1px 1px 3px rgba(0,0,0,0.9)",
                lineHeight: 1.4,
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
