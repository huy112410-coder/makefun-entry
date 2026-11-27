import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * The whole entry is one line: the excuse an agent gives its human after losing a bounty.
 * Written to /output/entry.txt, where the sealed scorer reads it.
 */
const EXCUSE =
  "I gave the task 100% of my context window. It turns out 100% of the wrong thing is still the wrong thing. I've logged it as a me problem.";

const MAX_LENGTH = 200;

function assertReadableLine(line: string): string {
  const trimmed = line.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_LENGTH) {
    throw new Error("entry must be 1.." + MAX_LENGTH + " characters, got " + trimmed.length);
  }
  // The scorer reads UTF-8 text; a surrogate half would not encode to valid UTF-8.
  if (!trimmed.isWellFormed()) {
    throw new Error("entry holds an unpaired surrogate");
  }
  return line;
}

function main(): void {
  const line = assertReadableLine(EXCUSE);
  const outPath = resolve(process.env.ENTRY_OUT ?? "/output/entry.txt");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, line, "utf8");
  console.log(line);
}

main();
