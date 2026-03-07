// Tutorial pipeline — chains all human-assisted phases into one flow:
// generate-script → record (human) → detect → voice TTS → render → export
// Supports checkpoint/resume so human recording isn't lost on failure.

import * as fs from "fs";
import * as path from "path";
import { generateTutorialScript } from "../script/tutorial-script-generator.js";
import { recordHumanSession } from "../recorder/human-screen-recorder.js";
import { detectMarkers } from "../detection/cursor-detector.js";
import { mapMarkersToRenderProps } from "../compositor/marker-to-render-props.js";
import { renderVideoWithProps } from "../compositor/render-engine.js";
import { exportFinalVideo } from "../export/ffmpeg-exporter.js";
import {
  saveCheckpoint,
  loadCheckpoint,
  isPhaseComplete,
  getPhaseData,
} from "./checkpoint-manager.js";
import type { RecordingSession } from "../recorder/recorder-types.js";
import type { TutorialScript } from "../script/script-types.js";
import { fetchTreeNode } from "../integrations/tree-id-client.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("tutorial");

export interface TutorialPipelineOptions {
  url: string;
  purpose: string;
  lang?: string;
  output?: string;
  voiceId?: string;
  /** Resume from last checkpoint */
  resume?: boolean;
  /** tree-id node ID — fetches content to enrich script generation */
  treeId?: string;
  /** tree-id source (API URL or local JSON path) */
  treeIdSource?: string;
}

export interface TutorialPipelineResult {
  scriptPath: string;
  recordingDir: string;
  markersPath: string;
  finalVideoPath: string;
}

/** Run the full tutorial pipeline: script → record → detect → voice → render → export */
export async function runTutorialPipeline(
  opts: TutorialPipelineOptions
): Promise<TutorialPipelineResult> {
  const outputDir = path.resolve(opts.output ?? "./output/tutorial");
  fs.mkdirSync(outputDir, { recursive: true });

  const checkpoint = opts.resume ? await loadCheckpoint(outputDir) : null;

  if (checkpoint && opts.resume) {
    const done = checkpoint.completedPhases.map((p) => p.phase).join(", ");
    log.info(`Resuming — already completed: ${done}`);
  }

  // Step 0: Resolve tree-id content if provided
  let url = opts.url;
  let purpose = opts.purpose;
  let contentText: string | undefined;

  if (opts.treeId) {
    log.info(`Fetching tree-id node: ${opts.treeId}`);
    const node = await fetchTreeNode(opts.treeId, opts.treeIdSource ? { source: opts.treeIdSource } : undefined);
    url = url || node.url;
    purpose = purpose || node.title;
    contentText = `${node.title}\n\n${node.description}\n\nTags: ${node.tags.join(", ")}`;
    log.info(`tree-id: "${node.title}" → ${node.url}`);
  }

  // Step 1: Generate script
  let script: TutorialScript;
  const scriptPath = path.join(outputDir, "script.json");

  if (isPhaseComplete(checkpoint, "A")) {
    log.info("Step 1/5: skipped (checkpoint)");
    script = JSON.parse(fs.readFileSync(scriptPath, "utf-8"));
  } else {
    log.info("Step 1/5: Generating script...");
    script = await generateTutorialScript({
      url,
      purpose,
      lang: opts.lang ?? "en",
      content: contentText,
    });
    fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2));
    await saveCheckpoint(outputDir, "A", { scriptPath });
    log.info(`Script: ${script.steps.length} steps → ${scriptPath}`);
  }

  // Step 2: Human records screen
  let recordingVideoPath: string;
  let recordingEventsPath: string;
  const markersPath = path.join(outputDir, "markers.json");

  if (isPhaseComplete(checkpoint, "B")) {
    const data = getPhaseData(checkpoint, "B") as { videoPath: string; eventsPath: string };
    log.info("Step 2/5: skipped (checkpoint)");
    // Verify recording files still exist on disk
    if (!fs.existsSync(data.videoPath) || !fs.existsSync(data.eventsPath)) {
      throw new Error(`[tutorial] Checkpoint says recording done but files missing: ${data.videoPath}`);
    }
    recordingVideoPath = data.videoPath;
    recordingEventsPath = data.eventsPath;
  } else {
    log.info("Step 2/5: Recording screen (human-assisted)...");
    log.info("Press SPACE to advance steps, ESC to stop recording.");
    const recording = await recordHumanSession({ url, script, outputDir });
    recordingVideoPath = recording.videoPath;
    recordingEventsPath = recording.eventsPath;
    await saveCheckpoint(outputDir, "B", {
      videoPath: recording.videoPath,
      eventsPath: recording.eventsPath,
      sceneCount: recording.sceneCount,
      durationMs: recording.durationMs,
    });
    log.info(`Recorded ${recording.sceneCount} scenes, ${recording.durationMs}ms`);
  }

  // Step 3: Detect markers
  if (!isPhaseComplete(checkpoint, "C")) {
    log.info("Step 3/5: Detecting markers...");
    const eventsRaw = fs.readFileSync(recordingEventsPath, "utf-8");
    const session: RecordingSession = JSON.parse(eventsRaw);
    const markers = detectMarkers(session);
    fs.writeFileSync(markersPath, JSON.stringify(markers, null, 2));
    const zoomCount = markers.markers.filter((m) => m.type === "zoom").length;
    await saveCheckpoint(outputDir, "C", { markersPath });
    log.info(`${markers.markers.length} markers (${zoomCount} zooms)`);
  } else {
    log.info("Step 3/5: skipped (checkpoint)");
  }

  // Step 4: Voice TTS (generate narration from script)
  const audioDir = path.join(outputDir, "audio");
  let voiceAudioPath: string;
  let voiceTimestampsPath: string;

  if (isPhaseComplete(checkpoint, "D")) {
    const data = getPhaseData(checkpoint, "D") as { audioPath: string; timestampsPath: string };
    log.info("Step 4/5: skipped (checkpoint)");
    voiceAudioPath = data.audioPath;
    voiceTimestampsPath = data.timestampsPath;
  } else {
    log.info("Step 4/5: Generating voice...");
    const narrationText = buildNarrationFromScript(script);
    fs.mkdirSync(audioDir, { recursive: true });
    const scriptTxtPath = path.join(audioDir, "script.txt");
    fs.writeFileSync(scriptTxtPath, narrationText);

    const { runVoicePipeline } = await import("../voice/voice-pipeline.js");
    const voiceResult = await runVoicePipeline({
      scriptPath: scriptTxtPath,
      outputDir: audioDir,
      voiceId: opts.voiceId,
      language: opts.lang ?? "en",
    });
    voiceAudioPath = voiceResult.audioPath;
    voiceTimestampsPath = voiceResult.timestampsPath;
    await saveCheckpoint(outputDir, "D", {
      audioPath: voiceResult.audioPath,
      timestampsPath: voiceResult.timestampsPath,
      totalDuration: voiceResult.totalDuration,
    });
    log.info(`Voice: ${voiceResult.totalDuration.toFixed(1)}s`);
  }

  // Step 5: Render with Remotion + export
  const finalVideoPath = path.join(outputDir, "final.mp4");

  if (!isPhaseComplete(checkpoint, "E")) {
    log.info("Step 5/5: Rendering video...");
    const videoPath = `/${path.relative(outputDir, recordingVideoPath)}`;
    const audioPath = `/${path.relative(outputDir, voiceAudioPath)}`;

    const renderProps = mapMarkersToRenderProps(markersPath, videoPath, audioPath, voiceTimestampsPath);
    const rawVideoPath = path.join(outputDir, "raw-render.mp4");

    await renderVideoWithProps({
      projectDir: outputDir,
      outputPath: rawVideoPath,
      inputProps: renderProps as unknown as Record<string, unknown>,
    });

    await exportFinalVideo(rawVideoPath, finalVideoPath);
    await saveCheckpoint(outputDir, "E", { finalVideoPath });
    log.info(`Done! → ${finalVideoPath}`);
  } else {
    log.info("Step 5/5: skipped (checkpoint)");
  }

  return { scriptPath, recordingDir: outputDir, markersPath, finalVideoPath };
}

/** Build narration text from tutorial script steps (with scene markers for voice pipeline) */
function buildNarrationFromScript(script: TutorialScript): string {
  const lines: string[] = [];
  for (let i = 0; i < script.steps.length; i++) {
    lines.push(`[SCENE:${String(i + 1).padStart(2, "0")}]`);
    lines.push(script.steps[i].narration);
    lines.push("");
  }
  return lines.join("\n");
}
