import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// The entry: one line, at most 200 characters, that reads as a funny autocorrect fail.
const LINE =
  "I texted my boss “I’m running late” and autocorrect sent “I’m ruining late.” He replied: “Finally, an accurate status update.”";

const MAX = 200;
if (LINE.length < 1 || LINE.length > MAX) {
  throw new Error("entry must be 1.." + MAX + " characters, got " + LINE.length);
}

const out = process.env.ENTRY_OUT ?? "/output/entry.txt";
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, LINE, "utf8");
console.log(LINE);
