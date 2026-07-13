import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const githubRoot = path.resolve(source, "..");
const targets = [
  path.join(githubRoot, "LatinNotes/dictionary"),
  path.join(githubRoot, "QualisArtifex/assets/linked-pages/latin-dictionary")
];
const rootFiles = ["index.html", "app.js", "open-words.js", "styles.css"];
const dataFiles = (await fs.readdir(path.join(source, "open-words")))
  .filter((name) => name.endsWith(".json"))
  .sort();

for (const target of targets) {
  await fs.mkdir(path.join(target, "open-words"), { recursive: true });
  await fs.rm(path.join(target, "assets"), { recursive: true, force: true });
  for (const name of rootFiles) {
    await fs.copyFile(path.join(source, name), path.join(target, name));
  }
  for (const name of dataFiles) {
    await fs.copyFile(path.join(source, "open-words", name), path.join(target, "open-words", name));
  }
  console.log(`Synchronized ${path.relative(githubRoot, target)}`);
}
