// Tutorial pipeline — chains all human-assisted phases into one flow:
// generate-script → record (human) → detect → voice TTS → render → export

import * as fs from "fs";
import * as path from "path";
import { generateTutorialScript } from "../script/tutorial-script-generator.js";
import { recordHumanSession } from "../recorder/human-screen-recorder.js";
import { detectMarkers } from "../detection/cursor-detector.js";
import { mapMarkersToRenderProps } from "../compositor/marker-to-render-props.js";
import { renderVideoWithProps } from "../compositor/render-engine.js";
import { exportFinalVideo } from "../export/ffmpeg-exporter.js";
import type { RecordingSession } from "../recorder/recorder-types.js";
import type { TutorialScript } from "../script/script-types.js";

export interface TutorialPipelineOptions {
  url: string;
  purpose: string;
  lang?: string;
  output?: string;
  voiceId?: string;
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

  // Step 1: Generate script
  console.log("\n[tutorial] Step 1/5: Generating script...");
  const script = await generateTutorialScript({
    url: opts.url,
    purpose: opts.purpose,
    lang: opts.lang ?? "en",
  });
  const scriptPath = path.join(outputDir, "script.json");
  fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2));
  console.log(`[tutorial] Script: ${script.steps.length} steps → ${scriptPath}`);

  // Step 2: Human records screen
  console.log("\n[tutorial] Step 2/5: Recording screen (human-assisted)...");
  console.log("[tutorial] Press SPACE to advance steps, ESC to stop recording.");
  const recording = await recordHumanSession({
    url: opts.url,
    script,
    outputDir,
  });
  console.log(`[tutorial] Recorded ${recording.sceneCount} scenes, ${recording.durationMs}ms`);

  // Step 3: Detect markers
  console.log("\n[tutorial] Step 3/5: Detecting markers...");
  const eventsRaw = fs.readFileSync(recording.eventsPath, "utf-8");
  const session: RecordingSession = JSON.parse(eventsRaw);
  const markers = detectMarkers(session);
  const markersPath = path.join(outputDir, "markers.json");
  fs.writeFileSync(markersPath, JSON.stringify(markers, null, 2));
  const zoomCount = markers.markers.filter((m) => m.type === "zoom").length;
  console.log(`[tutorial] ${markers.markers.length} markers (${zoomCount} zooms)`);

  // Step 4: Voice TTS (generate narration from script)
  console.log("\n[tutorial] Step 4/5: Generating voice...");
  const narrationText = buildNarrationFromScript(script);
  const audioDir = path.join(outputDir, "audio");
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
  console.log(`[tutorial] Voice: ${voiceResult.totalDuration.toFixed(1)}s`);

  // Step 5: Render with Remotion
  console.log("\n[tutorial] Step 5/5: Rendering video...");
  const videoPath = `/${path.relative(outputDir, recording.videoPath)}`;
  const audioPath = `/${path.relative(outputDir, voiceResult.audioPath)}`;
  const wordsPath = voiceResult.timestampsPath;

  const renderProps = mapMarkersToRenderProps(markersPath, videoPath, audioPath, wordsPath);
  const rawVideoPath = path.join(outputDir, "raw-render.mp4");

  await renderVideoWithProps({
    projectDir: outputDir,
    outputPath: rawVideoPath,
    inputProps: renderProps as unknown as Record<string, unknown>,
  });

  // Export final video with ffmpeg
  const finalVideoPath = path.join(outputDir, "final.mp4");
  await exportFinalVideo(rawVideoPath, finalVideoPath);
  console.log(`\n[tutorial] Done! → ${finalVideoPath}`);

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
