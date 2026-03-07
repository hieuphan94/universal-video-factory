# Video Factory - Code Standards & Guidelines

## Language & Type Safety

### TypeScript Configuration
- **Target:** ES2022 with Node.js module resolution
- **Strict Mode:** Enabled (`"strict": true`)
- **Key Settings:**
  - `esModuleInterop: true` — Seamless CommonJS interop
  - `resolveJsonModule: true` — Import JSON files directly
  - `declaration: true` — Generate .d.ts files
  - `sourceMap: true` — Debug support
  - `forceConsistentCasingInFileNames: true` — Prevent case-sensitive mismatches

### Non-Negotiable Rules
1. **No `any` type** — Use explicit types or generics
2. **Null checks** — Explicit null/undefined handling before access
3. **Error types** — Throw typed errors; catch specific error classes
4. **No loose comparisons** — Always use `===` and `!==`
5. **Immutability** — Use `const` by default; avoid mutating function parameters

## File & Module Organization

### Naming Conventions
- **Files:** `kebab-case.ts` (e.g., `script-generator.ts`, `browser-manager.ts`)
- **Classes:** `PascalCase` (e.g., `BrowserManager`, `PipelineCoordinator`)
- **Functions:** `camelCase` (e.g., `parseArguments()`, `renderVideo()`)
- **Constants:** `SCREAMING_SNAKE_CASE` (e.g., `DEFAULT_VIEWPORT_WIDTH`)
- **Interfaces:** `PascalCase` (e.g., `PipelineConfig`, `ElementMap`)

**Rationale:** Self-documenting names for LLM tools (Grep, Glob); easy to identify purpose at a glance.

### File Size Limits
- **Target:** ≤ 200 lines per file
- **Exceptions:** Configuration files, test files, markdown
- **Approach:** Modularize by logical concern (e.g., separate `browser-manager.ts` from `cursor-tracker.ts`)

### Directory Structure
```
src/
├── {module-name}/
│   ├── index.ts              (optional re-export if convenient)
│   ├── types.ts              (all TypeScript interfaces for module)
│   ├── primary-class.ts      (main functionality)
│   ├── helper-class.ts       (secondary functionality)
│   └── constants.ts          (module-specific constants, if needed)
```

**Rule:** Each directory represents a logical module with clear responsibility.

## Import Organization

### Order
1. External libraries (`import { Hono }`)
2. Relative imports from parent/siblings (`../orchestrator/...`)
3. Type imports (use `import type { }` for types only)

### Relative Paths
- Use `./` for same directory
- Use `../` for parent directory
- Use absolute imports only for entry points (e.g., `src/cli/index.ts`)

### Example
```typescript
import * as fs from "fs/promises";
import * as path from "path";
import { Anthropic } from "@anthropic-ai/sdk";
import { BrowserManager } from "../capture/browser-manager.js";
import type { DirectorConfig } from "./types.js";

// Code follows...
```

## Error Handling

### Error Throwing
- Throw descriptive, typed errors with context
- Include error details that help debugging

```typescript
// Good
if (!apiKey) {
  throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local");
}

// Also good — custom error class
class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
throw new ValidationError(`Invalid URL: ${url}`);
```

### Error Catching
- Catch specific error types
- Log full context (error message + relevant data)
- Don't silently swallow errors

```typescript
// Good
try {
  await browserManager.navigate(url);
} catch (err) {
  const errorMsg = err instanceof Error ? err.message : String(err);
  console.error(`[Pipeline] Navigation failed: ${errorMsg}`);
  throw err; // Re-throw or handle gracefully
}

// Bad
try {
  await browserManager.navigate(url);
} catch {
  // Silent failure — hard to debug
}
```

### Try/Catch in Async Code
- Use try/catch in `async` functions (preferred)
- Avoid unhandled promise rejections

```typescript
// Good
async function runPipeline(): Promise<void> {
  try {
    const result = await orchestrator.run();
    console.log("Pipeline complete");
  } catch (err) {
    handleError(err);
  }
}

// Avoid
orchestrator.run().then(r => ...).catch(e => ...);
```

## Code Style & Readability

### Comments
- **Why:** Explain non-obvious design decisions
- **What:** Avoid stating what code obviously does
- **Where:** Complex algorithms, external API quirks, performance considerations

```typescript
// Good — explains intent
// ElevenLabs with-timestamps returns character-level alignment; merge within threshold
const merged = mergeTimestamps(timestamps, 50); // 50ms window

// Bad — restates code
// Loop through array and print each item
for (const item of items) {
  console.log(item);
}
```

### Function Documentation
- Use JSDoc for public functions
- Document parameters, return type, and exceptions

```typescript
/**
 * Analyzes a screenshot with Claude Vision to extract interactive elements.
 * @param imagePath Path to PNG screenshot
 * @param feature Feature description for context
 * @returns Array of detected elements with confidence scores
 * @throws Error if Claude API returns error or invalid response
 */
async function analyze(imagePath: string, feature: string): Promise<ElementMap[]> {
  // Implementation
}
```

### Naming Clarity
- **Variable names:** Descriptive and unambiguous
- **Boolean variables:** Prefix with `is`, `has`, `can`, `should`

```typescript
// Good
const isPhaseComplete = checkpoint && checkpoint.completedPhases.includes("A");
const hasValidApiKey = apiKey && apiKey.startsWith("sk-");
const shouldRetry = attempt < maxAttempts;

// Bad
const complete = true;  // Complete what?
const key = apiKey;     // Obvious, unnecessary
const retry = true;     // In what context?
```

## Async/Await Patterns

### Sequencing
- Use `await` for sequential operations
- Use `Promise.all()` for independent parallel tasks

```typescript
// Sequential — each depends on previous result
const screenshot = await browserManager.screenshot(url);
const analysis = await analyzer.analyze(screenshot);
const script = await generator.generate(analysis);

// Parallel — independent operations
const [users, products, settings] = await Promise.all([
  fetchUsers(),
  fetchProducts(),
  fetchSettings()
]);
```

### Timeout Handling
- Always set timeouts for network/browser operations

```typescript
const timeoutMs = 30000;
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);

try {
  const response = await fetch(url, { signal: controller.signal });
  return response.json();
} finally {
  clearTimeout(timeout);
}
```

## Testing

### Test Framework
- **Framework:** Vitest (configured in `tests/vitest.config.ts`)
- **Style:** Unit tests for utilities, integration tests for pipelines
- **Coverage:** Aim for ≥80% for critical paths (Phase A, B, E)

### Test File Naming
- Located in `tests/` directory
- Named `{module}.test.ts` (e.g., `retry.test.ts`)
- Match `src/` structure in `tests/`

### Test Structure
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { retry } from "../src/utils/retry.js";

describe("retry utility", () => {
  it("should retry on failure and eventually succeed", async () => {
    let attempts = 0;
    const result = await retry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error("Not ready");
        return "success";
      },
      { maxAttempts: 5, delayMs: 10 }
    );
    expect(result).toBe("success");
    expect(attempts).toBe(3);
  });

  it("should throw after max attempts exhausted", async () => {
    await expect(
      retry(
        async () => { throw new Error("Always fails"); },
        { maxAttempts: 2, delayMs: 1 }
      )
    ).rejects.toThrow("Always fails");
  });
});
```

### No Mocks (Real Integration Tests)
- **Rule:** Never mock external services for critical paths
- Instead: Use real APIs with test credentials, or skip if credentials unavailable
- Only mock filesystem for isolated utility tests

```typescript
// Bad — mocks Claude API (defeats purpose of testing)
vi.mock("@anthropic-ai/sdk", () => ({
  Anthropic: vi.fn(() => ({
    messages: { create: vi.fn(() => ({ content: [{ text: "mocked" }] })) }
  }))
}));

// Good — test with real API or skip
it.skipIf(!process.env.ANTHROPIC_API_KEY)("should analyze screenshot", async () => {
  const analysis = await analyzer.analyze(imagePath, "sign up");
  expect(analysis.elements.length).toBeGreaterThan(0);
});
```

### Running Tests
```bash
npm test              # Run once
npm run test:watch   # Watch mode
```

## Logging

### Structured Logging
- Use the logger from `src/utils/logger.ts`
- Log to both console (user-facing) and file (debugging)

```typescript
import { createLogger } from "../utils/logger.js";

const log = createLogger("ai-director");

log.info("Starting screenshot analysis");
log.debug("Claude response received", confidence, elementCount);
log.warn("Low confidence element detected");
log.error("API failed", err.message);
```

### Log Levels
- **info** — Normal operation milestones
- **debug** — Detailed state information (only when verbose)
- **warn** — Recoverable issues (fallback used, retry attempted)
- **error** — Fatal conditions (exception, pipeline abort)

### Log Output
- **Console:** Formatted, human-readable for user
- **File:** JSON for machine parsing and analysis
- **Location:** `{output}/pipeline.log`

## Configuration Management

### Environment Variables
- Load from `.env.local` (takes precedence) or `.env` via `dotenv`
- Validate at startup (CLI checks for required keys)
- Use `process.env` with fallback defaults

```typescript
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  throw new Error("ANTHROPIC_API_KEY is not set");
}

const viewportWidth = parseInt(process.env.VIEWPORT_WIDTH ?? "1920");
const retryAttempts = parseInt(process.env.CLICK_RETRY_ATTEMPTS ?? "2");
```

### Type-Safe Config Objects
- Use Zod or similar for config validation
- Define interfaces for all configuration shapes

```typescript
import { z } from "zod";

const ConfigSchema = z.object({
  url: z.string().url(),
  feature: z.string().min(1),
  lang: z.string().default("en"),
  output: z.string().default("./output"),
});

const config = ConfigSchema.parse({
  url: argv.url,
  feature: argv.feature,
  lang: argv.lang,
  output: argv.output,
});
```

## Performance Considerations

### Memory Management
- Stream large files instead of loading into memory
- Clean up temporary files immediately after use
- Avoid storing entire video frames in arrays

### I/O Optimization
- Use `fs/promises` for non-blocking file operations
- Batch database writes when possible
- Cache expensive computations (e.g., browser initialization)

### Concurrency
- Use `Promise.all()` for independent parallel tasks
- Limit concurrent browser instances (configured in pipeline)
- Use worker threads for long-running jobs

## Git & Commit Standards

### Commit Format
- Follow Conventional Commits: `type(scope): description`
- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`
- Example: `feat(ai-director): add Stagehand fallback for low-confidence elements`

### Commit Guidelines
- One logical change per commit
- Include only relevant code changes (no noise)
- Don't commit secrets, build artifacts, or node_modules
- Use present tense ("add feature" not "added feature")

### Pre-Commit Checks
- Run `npm run typecheck` — TypeScript validation
- Run `npm run build` — Ensure code compiles
- Run `npm test` — Unit tests pass
- Never commit failing tests

## Build & Deployment

### Build Process
```bash
npm run build      # Compile TypeScript via tsup
npm run typecheck  # Type validation
npm run dev        # Run from source (development)
npm start          # Run from dist/ (production)
```

### Output
- **CLI:** `dist/cli/index.js` (entry point)
- **Server:** `dist/server/index.js` (HTTP API)
- **Dashboard:** `src/dashboard/dist/` (React SPA)

### Production Checklist
- [ ] All tests passing
- [ ] No TypeScript errors
- [ ] Secrets not in code (use .env.local)
- [ ] No debug logging in final output
- [ ] API keys validated at startup
- [ ] Error messages are user-friendly

## Security Considerations

### API Keys
- Never commit to git (use .env.local in .gitignore)
- Validate presence before startup
- Don't log full API key (log first/last 4 chars only if needed)

### User Input Validation
- Validate all CLI arguments before use
- Validate file paths to prevent directory traversal
- Escape user input in URLs and file names

### Browser Security
- Always run Playwright in headless mode for untrusted content
- Use cookies only from trusted sources (user-provided)
- Sanitize URLs before navigation

### Data Handling
- Don't log user credentials or sensitive data
- Clean up temporary files containing screenshots/recordings
- Store job queue locally (no public access without auth)

## Documentation Updates

### When to Update Docs
- [ ] After adding new CLI option
- [ ] After changing pipeline phase logic
- [ ] After modifying config schema
- [ ] After updating dependencies
- [ ] After fixing known bugs or workarounds

### Docs to Update
- `docs/code-standards.md` — This file (if adding new patterns)
- `docs/system-architecture.md` — If adding/removing modules
- `docs/project-overview-pdr.md` — If changing requirements or status
- `README.md` — User-facing usage and troubleshooting

## Review Checklist (Before Committing)

- [ ] Code compiles with zero TypeScript errors
- [ ] All tests pass (or are explicitly skipped with reason)
- [ ] No `console.log()` without structured logging
- [ ] No `any` types
- [ ] Error messages are descriptive
- [ ] File names follow kebab-case
- [ ] Imports organized and cleaned up
- [ ] No hardcoded secrets or API keys
- [ ] Comments explain "why", not "what"
- [ ] Commit message follows Conventional Commits
- [ ] Changes documented in appropriate docs files
