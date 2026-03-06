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

interface ZoomContainerProps {
  zoomEvents: ZoomEvent[];
  children: React.ReactNode;
}

const MAX_SCALE = 2.0;
const SPRING_CFG = { damping: 20, stiffness: 120 };
// Frames for zoom-in and zoom-out spring animation
const TRANSITION_FRAMES = 15;
// Frames to smoothly pan origin between consecutive zoom events
const PAN_FRAMES = 20;

/**
 * Wraps scene content with spring-animated zoom keyed to click events.
 *
 * For each zoom event:
 *   - Zoom in  : spring from 1.0 → target scale (15 frames)
 *   - Hold     : maintain target scale for `duration` frames
 *   - Zoom out : spring back to 1.0 (15 frames)
 *
 * When consecutive zoom events overlap or are close together,
 * the focus point smoothly pans between them instead of snapping.
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
  for (let i = 0; i < zoomEvents.length; i++) {
    const event = zoomEvents[i];
    const targetScale = Math.min(event.scale, MAX_SCALE);
    const zoomInEnd = event.frame + TRANSITION_FRAMES;
    const holdEnd = zoomInEnd + event.duration;
    const zoomOutEnd = holdEnd + TRANSITION_FRAMES;

    if (frame < event.frame || frame > zoomOutEnd) continue;

    const relFrame = frame - event.frame;

    let scale: number;
    if (relFrame <= TRANSITION_FRAMES) {
      // Zoom in phase
      const progress = spring({
        fps,
        frame: relFrame,
        config: SPRING_CFG,
        durationInFrames: TRANSITION_FRAMES,
      });
      scale = 1.0 + (targetScale - 1.0) * progress;
    } else if (relFrame <= TRANSITION_FRAMES + event.duration) {
      // Hold phase
      scale = targetScale;
    } else {
      // Zoom out phase
      const outFrame = relFrame - (TRANSITION_FRAMES + event.duration);
      const progress = spring({
        fps,
        frame: outFrame,
        config: SPRING_CFG,
        durationInFrames: TRANSITION_FRAMES,
      });
      scale = targetScale - (targetScale - 1.0) * progress;
    }

    currentScale = scale;

    // Smooth pan: interpolate origin from previous event's focus point
    if (i > 0) {
      const prevEvent = zoomEvents[i - 1];
      const panStart = event.frame;
      const panEnd = event.frame + PAN_FRAMES;
      const panProgress = interpolate(frame, [panStart, panEnd], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      originX = prevEvent.x + (event.x - prevEvent.x) * panProgress;
      originY = prevEvent.y + (event.y - prevEvent.y) * panProgress;
    } else {
      originX = event.x;
      originY = event.y;
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
