import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rawPath = process.argv[2];

if (!rawPath) {
  throw new Error("Usage: node scripts/build-entry-metadata.mjs /path/to/DICTLINE.GEN");
}

const [raw, words, corrections] = await Promise.all([
  fs.readFile(path.resolve(rawPath), "latin1"),
  fs.readFile(path.join(root, "open-words/words.json"), "utf8").then(JSON.parse),
  fs.readFile(path.join(root, "open-words/word-corrections.json"), "utf8").then(JSON.parse)
]);

const lines = raw.split(/\r?\n/).filter(Boolean);
if (lines.length !== words.length) {
  throw new Error(`Expected ${words.length} DICTLINE records, found ${lines.length}`);
}

const codes = lines.map((line, index) => {
  const code = line.slice(100, 109).replace(/\s/g, "");
  if (!/^[A-Z?]{5}$/.test(code)) {
    throw new Error(`Invalid metadata code for dictionary id ${index + 1}: ${JSON.stringify(code)}`);
  }
  if (words[index].id !== index + 1) {
    throw new Error(`Dictionary ids are not contiguous at record ${index + 1}`);
  }
  return code;
});

// Records repaired after the historic Open Words conversion retain their
// reference metadata here. The correction currently restores Whitaker's sum.
const correctionCodes = new Map([[39338, "XXXAX"]]);
for (const correction of corrections) {
  const code = correctionCodes.get(correction.id);
  if (!code) throw new Error(`Missing metadata for correction id ${correction.id}`);
  codes[correction.id - 1] = code;
}

const payload = {
  fields: ["age", "area", "geography", "frequency", "source"],
  codes
};

await fs.writeFile(
  path.join(root, "open-words/entry-metadata.json"),
  `${JSON.stringify(payload)}\n`
);

console.log(`Wrote metadata for ${codes.length} dictionary records.`);
