// CLI command: video-factory tutorial --url <url> --purpose <text> [--lang en] [--output dir]
// One-shot: generate script → human records → detect → voice → render → export

import type { Argv } from "yargs";
import { runTutorialPipeline } from "../orchestrator/tutorial-pipeline.js";

export function registerTutorialCommand(yargs: Argv): void {
  yargs.command(
    "tutorial",
    "Create a tutorial video (script → record → detect → render)",
    (y) =>
      y
        .option("url", {
          type: "string",
          description: "Target URL to record",
          demandOption: true,
        })
        .option("purpose", {
          type: "string",
          description: 'What the tutorial demonstrates (e.g. "How to login")',
          demandOption: true,
        })
        .option("lang", {
          type: "string",
          description: "Language code (default: en)",
          default: "en",
        })
        .option("output", {
          type: "string",
          description: "Output directory (default: ./output/tutorial)",
        })
        .option("voice", {
          type: "string",
          description: "ElevenLabs voice ID",
        }),
    async (argv) => {
      const result = await runTutorialPipeline({
        url: argv.url as string,
        purpose: argv.purpose as string,
        lang: argv.lang as string,
        output: argv.output as string | undefined,
        voiceId: argv.voice as string | undefined,
      });
      console.log(`\nTutorial complete!`);
      console.log(`  Video: ${result.finalVideoPath}`);
    }
  );
}
