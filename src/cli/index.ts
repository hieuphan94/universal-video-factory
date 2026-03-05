// CLI entry point — yargs setup, env loading, pipeline invocation

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import * as child_process from "child_process";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { parseArguments, ArgumentValidationError } from "./parse-arguments.js";
import { PipelineCoordinator } from "../orchestrator/pipeline-coordinator.js";
import { configureLogger } from "../utils/logger.js";
import { ProgressDisplay } from "./progress-display.js";

// Load .env.local if present (takes precedence over .env)
const envLocalPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocalPath)) {
  const { configDotenv } = await import("dotenv");
  configDotenv({ path: envLocalPath, override: true });
}

// Check if "serve" subcommand is being invoked
const rawArgs = hideBin(process.argv);
if (rawArgs[0] === "serve") {
  const serveArgv = await yargs(rawArgs)
    .command("serve", "Start web dashboard server", (y) =>
      y.option("port", {
        type: "number",
        description: "Server port (default: 3456)",
        default: 3456,
      })
    )
    .help()
    .parseAsync();

  const { runServe } = await import("../server/serve-command.js");
  runServe(serveArgv.port as number);
  // Server keeps running — don't fall through to pipeline code
  await new Promise(() => {}); // block forever
}

const argv = await yargs(rawArgs)
  .scriptName("video-factory")
  .usage("$0 --url <url> --feature <feature> [options]")
  .option("url", {
    type: "string",
    description: "Target URL to record (must be http/https)",
    demandOption: true,
  })
  .option("feature", {
    type: "string",
    description: 'Feature to demonstrate (e.g. "sign up", "checkout flow")',
    demandOption: true,
  })
  .option("lang", {
    type: "string",
    description: "Narration language code (default: en)",
    default: "en",
  })
  .option("brand", {
    type: "string",
    description: "Path to brand assets directory (logo, colors, fonts)",
  })
  .option("voice", {
    type: "string",
    description: "Path to voice config JSON (ElevenLabs voice ID + settings)",
  })
  .option("cookies", {
    type: "string",
    description: "Path to cookies JSON file for session injection",
  })
  .option("manual", {
    type: "boolean",
    description: "Pause before screenshot for manual navigation",
    default: false,
  })
  .option("output", {
    type: "string",
    description: "Output directory path (default: ./output)",
    default: "./output",
  })
  .option("resume", {
    type: "boolean",
    description: "Resume pipeline from last checkpoint",
    default: false,
  })
  .option("preview", {
    type: "boolean",
    description: "Render at 720p for faster preview iteration",
    default: false,
  })
  .option("verbose", {
    type: "boolean",
    description: "Enable debug-level log output",
    default: false,
  })
  .example(
    '$0 --url=https://example.com --feature="sign up"',
    "Record sign-up flow tutorial"
  )
  .example(
    '$0 --url=https://app.example.com --feature="checkout" --cookies=./session.json --output=./my-video',
    "Record authenticated checkout with cookies"
  )
  .example("$0 serve --port=3456", "Start web dashboard")
  .help()
  .alias("h", "help")
  .version()
  .alias("v", "version")
  .strict()
  .parseAsync();

// Startup dependency check
function checkDependency(cmd: string): boolean {
  try {
    child_process.execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const missingDeps: string[] = [];
if (!checkDependency("ffmpeg")) missingDeps.push("ffmpeg (brew install ffmpeg)");
if (!checkDependency("node"))   missingDeps.push("node 20+ (brew install node)");
if (missingDeps.length > 0) {
  console.error("[video-factory] Missing required dependencies:");
  for (const dep of missingDeps) console.error(`  - ${dep}`);
  process.exit(1);
}

// Validate arguments
let config;
try {
  config = parseArguments({
    url: argv.url,
    feature: argv.feature,
    lang: argv.lang,
    brand: argv.brand,
    voice: argv.voice,
    cookies: argv.cookies,
    manual: argv.manual,
    output: argv.output,
  });
} catch (err) {
  if (err instanceof ArgumentValidationError) {
    console.error(`[video-factory] Error: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

// Configure structured logger
const outputDir = path.resolve(config.output);
fs.mkdirSync(outputDir, { recursive: true });
configureLogger(outputDir, argv.verbose);

console.log(`[video-factory] Starting pipeline`);
console.log(`  URL:     ${config.url}`);
console.log(`  Feature: ${config.feature}`);
console.log(`  Lang:    ${config.lang}`);
console.log(`  Output:  ${config.output}`);
if (config.cookies) console.log(`  Cookies: ${config.cookies}`);
if (config.manual)  console.log(`  Mode:    MANUAL`);
if (argv.resume)    console.log(`  Resume:  enabled`);
if (argv.preview)   console.log(`  Preview: 720p`);

const progress = new ProgressDisplay();
const coordinator = new PipelineCoordinator(config, {
  resume: argv.resume,
  preview: argv.preview,
  progress,
});
const result = await coordinator.run();

if (result.success) {
  const finalPath = result.export?.finalPath ?? config.output;
  progress.summary(finalPath);
  process.exit(0);
} else {
  console.error(`\n[video-factory] Pipeline failed: ${result.error}`);
  console.error(`[video-factory] See pipeline.log in output dir for details.`);
  process.exit(1);
}
