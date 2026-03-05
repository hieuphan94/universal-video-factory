import React from "react";
import { useCurrentFrame, useVideoConfig, spring } from "remotion";

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

interface ZoomContainerProps {
  zoomEvents: ZoomEvent[];
  children: React.ReactNode;
}

const MAX_SCALE = 2.0;
const SPRING_CFG = { damping: 20, stiffness: 120 };

/**
 * Wraps scene content with spring-animated zoom keyed to click events.
 *
 * For each zoom event:
 *   - Zoom in  : spring from 1.0 → target scale (frames 0-15 relative)
 *   - Hold     : maintain target scale for `duration` frames
 *   - Zoom out : spring back to 1.0 (15 frames)
 *
 * CSS transform-origin is set to the click point so the zoom centers
 * on the area of interest.
 */
export const ZoomContainer: React.FC<ZoomContainerProps> = ({
  zoomEvents,
  children,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  // Compute combined scale and origin from all active zoom events
  let currentScale = 1.0;
  let originX = width / 2;
  let originY = height / 2;

  for (const event of zoomEvents) {
    const targetScale = Math.min(event.scale, MAX_SCALE);
    const zoomInEnd = event.frame + 15;
    const holdEnd = zoomInEnd + event.duration;
    const zoomOutEnd = holdEnd + 15;

    if (frame < event.frame || frame > zoomOutEnd) continue;

    const relFrame = frame - event.frame;

    let scale: number;
    if (relFrame <= 15) {
      // Zoom in phase
      const progress = spring({
        fps,
        frame: relFrame,
        config: SPRING_CFG,
        durationInFrames: 15,
      });
      scale = 1.0 + (targetScale - 1.0) * progress;
    } else if (relFrame <= 15 + event.duration) {
      // Hold phase
      scale = targetScale;
    } else {
      // Zoom out phase
      const outFrame = relFrame - (15 + event.duration);
      const progress = spring({
        fps,
        frame: outFrame,
        config: SPRING_CFG,
        durationInFrames: 15,
      });
      scale = targetScale - (targetScale - 1.0) * progress;
    }

    // Last active event wins for origin
    currentScale = scale;
    originX = event.x;
    originY = event.y;
  }

  // Translate so zoom origin stays visually anchored at click point
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
