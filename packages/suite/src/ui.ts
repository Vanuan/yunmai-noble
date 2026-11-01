import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Logger } from "@yunmai-noble/historian/logger";

const UI_DIR = fileURLToPath(new URL("../../ui", import.meta.url));
const UI_INDEX = fileURLToPath(
  new URL("../../ui/dist/index.html", import.meta.url)
);

// The historian serves packages/ui/dist when it exists and the fallback page
// otherwise. Build once on first run so `bun run suite` serves the dashboard
// from a fresh checkout.
export function ensureUiBuild(runtime: string, logger: Logger): void {
  if (existsSync(UI_INDEX)) return;
  if (!existsSync(fileURLToPath(new URL("../../ui/package.json", import.meta.url)))) {
    return;
  }

  logger.log("suite: building web UI (first run)");
  const result = Bun.spawnSync({
    cmd: [runtime, "run", "build"],
    cwd: UI_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });

  if (result.exitCode !== 0) {
    logger.error("suite: web UI build failed; serving the fallback page");
  }
}
