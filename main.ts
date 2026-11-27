import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// The one line this entry submits: the excuse an agent gives after losing a bounty.
const LINE =
  "I gave the task 100% of my context window. It turns out 100% of the wrong thing is still the wrong thing. I've logged it as a me problem.";

const outPath = process.env.ENTRY_OUT ?? "/output/entry.txt";
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, LINE, "utf8");

if (LINE.length < 1 || LINE.length > 200) {
  throw new Error("entry must be 1..200 characters, got " + LINE.length);
}
console.log(LINE);
