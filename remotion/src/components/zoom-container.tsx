import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

interface ZoomEvent {
  /** Absolute frame when zoom starts */
  frame: number;
  /** Focus point X in pixels */
  x: number;
  /** Focus point Y in pixels */
  y: number;
  /** Target scale (clamped to max 2.0) */
  scale: number;
  /** How many frames to hold at target scale before zooming back out */
  duration: number;
}

interface CursorPoint {
  frame: number;
  x: number;
  y: number;
}

interface ZoomContainerProps {
  zoomEvents: ZoomEvent[];
  /** Sampled cursor positions — zoom follows cursor smoothly when available */
  cursorTrail?: CursorPoint[];
  children: React.ReactNode;
}

const MAX_SCALE = 2.0;
const SPRING_CFG = { damping: 20, stiffness: 120 };
// Frames for zoom-in and zoom-out spring animation
const TRANSITION_FRAMES = 15;
// Frames to smoothly pan origin between consecutive zoom events
const PAN_FRAMES = 20;

/** Interpolate cursor position from trail samples using linear interpolation */
function interpolateCursorPosition(
  trail: CursorPoint[],
  frame: number,
): { x: number; y: number } {
  // Before first sample
  if (frame <= trail[0].frame) return { x: trail[0].x, y: trail[0].y };
  // After last sample
  const last = trail[trail.length - 1];
  if (frame >= last.frame) return { x: last.x, y: last.y };

  // Find bracketing samples and lerp
  for (let i = 0; i < trail.length - 1; i++) {
    const a = trail[i];
    const b = trail[i + 1];
    if (frame >= a.frame && frame <= b.frame) {
      const t = b.frame === a.frame ? 0 : (frame - a.frame) / (b.frame - a.frame);
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      };
    }
  }

  return { x: last.x, y: last.y };
}

/**
 * Wraps scene content with continuous spring-animated zoom.
 *
 * Instead of zooming in/out per event, maintains a seamless zoom:
 *   - First event  : spring from 1.0 → target scale
 *   - Between events: stay zoomed, smoothly pan focus point
 *   - Last event   : spring back to 1.0 after hold
 *
 * This produces smooth, professional-looking video output.
 */
export const ZoomContainer: React.FC<ZoomContainerProps> = ({
  zoomEvents,
  cursorTrail = [],
  children,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  let currentScale = 1.0;
  let originX = width / 2;
  let originY = height / 2;

  if (zoomEvents.length > 0) {
    const firstEvent = zoomEvents[0];
    const lastEvent = zoomEvents[zoomEvents.length - 1];

    // Overall zoom timeline: zoom in at first event, zoom out after last event
    const zoomInStart = firstEvent.frame;
    const zoomInEnd = zoomInStart + TRANSITION_FRAMES;
    const zoomOutStart = lastEvent.frame + lastEvent.duration;
    const zoomOutEnd = zoomOutStart + TRANSITION_FRAMES;

    // Find current active event's target scale
    let activeScale = Math.min(firstEvent.scale, MAX_SCALE);
    for (const event of zoomEvents) {
      if (frame >= event.frame) {
        activeScale = Math.min(event.scale, MAX_SCALE);
      }
    }

    if (frame >= zoomInStart && frame <= zoomOutEnd) {
      if (frame <= zoomInEnd) {
        // Zoom in phase (first event)
        const progress = spring({
          fps,
          frame: frame - zoomInStart,
          config: SPRING_CFG,
          durationInFrames: TRANSITION_FRAMES,
        });
        currentScale = 1.0 + (activeScale - 1.0) * progress;
      } else if (frame <= zoomOutStart) {
        // Holding zoom — continuous throughout all events
        currentScale = activeScale;
      } else {
        // Zoom out phase (after last event)
        const progress = spring({
          fps,
          frame: frame - zoomOutStart,
          config: SPRING_CFG,
          durationInFrames: TRANSITION_FRAMES,
        });
        currentScale = activeScale - (activeScale - 1.0) * progress;
      }
    }

    // Determine focus point — follow cursor trail smoothly when available
    if (cursorTrail.length >= 2) {
      // Interpolate between nearest cursor trail samples
      const pos = interpolateCursorPosition(cursorTrail, frame);
      originX = pos.x;
      originY = pos.y;
    } else {
      // Fallback: snap between zoom event positions
      for (let i = zoomEvents.length - 1; i >= 0; i--) {
        if (frame >= zoomEvents[i].frame) {
          originX = zoomEvents[i].x;
          originY = zoomEvents[i].y;
          break;
        }
      }
    }
  }

  // Translate so zoom origin stays visually anchored at focus point
  const tx = (width / 2 - originX) * (currentScale - 1);
  const ty = (height / 2 - originY) * (currentScale - 1);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        transformOrigin: "center center",
        transform: `scale(${currentScale}) translate(${tx / currentScale}px, ${ty / currentScale}px)`,
        willChange: "transform",
      }}
    >
      {children}
    </div>
  );
};
