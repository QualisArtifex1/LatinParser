import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.dirname(new URL(import.meta.url).pathname);
const nativeFetch = globalThis.fetch.bind(globalThis);
const readJson = async (name) => JSON.parse(await fs.readFile(path.join(root, name), "utf8"));

globalThis.fetch = async (url) => {
  const localPath = String(url).split("?", 1)[0].replace("./open-words/", "open-words/");
  try {
    return { ok: true, json: async () => readJson(localPath) };
  } catch {
    return { ok: false };
  }
};

const { lookupLatinWord } = await import(pathToFileURL(path.join(root, "open-words.js")));
const cases = await readJson("reference-cases.json");
const [sourceWords, wordCorrections, stems, importedInflections, inflectionCorrections, uniques, entryMetadata, inflectionSourceManifest] = await Promise.all(
  ["words", "word-corrections", "stems", "inflects", "inflection-corrections", "uniques", "entry-metadata", "inflection-source-manifest"]
    .map((name) => readJson(`open-words/${name}.json`))
);
const words = [...sourceWords, ...wordCorrections];
const inflections = [...importedInflections, ...inflectionCorrections];
const wordsById = new Map(words.map((word) => [word.id, word]));
const errors = [];
const fail = (message) => errors.push(message);
const normalize = (value) => value.toLocaleLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/j/g, "i").replace(/v/g, "u").replace(/[^a-z]/g, "");

function requiredEntryMatches(entry, required) {
  return entry.lemma === required.lemma && entry.part.startsWith(required.partPrefix) &&
    (required.forms ?? []).every((form) => entry.forms.includes(form));
}

function inflectionKey(inflection) {
  return [
    inflection.pos,
    ...(inflection.n ?? []),
    inflection.form.replace(/\s+/g, " ").trim(),
    inflection.ending,
    inflection.note ?? ""
  ].join("|");
}

function validateEntries(token, entries) {
  const validParts = ["noun", "verb", "participle", "adjective", "adverb", "preposition", "pronoun", "number", "conjunction", "interjection", "supine", "pack"];
  for (const entry of entries) {
    if (!entry.lemma?.trim()) fail(`${token}: blank lemma`);
    if (!validParts.some((part) => entry.part === part || entry.part.startsWith(`${part} ·`))) {
      fail(`${token}: invalid displayed part of speech ${JSON.stringify(entry.part)}`);
    }
    if (!Array.isArray(entry.forms) || entry.forms.length === 0) fail(`${token}: ${entry.lemma} has no forms`);
    if (new Set(entry.forms).size !== entry.forms.length) fail(`${token}: ${entry.lemma} repeats a form`);
    if (!Array.isArray(entry.senses) || entry.senses.length === 0) fail(`${token}: ${entry.lemma} has no senses`);
    if (new Set(entry.senses).size !== entry.senses.length) fail(`${token}: ${entry.lemma} repeats a sense`);
    if (entry.meaning !== entry.senses?.[0]) fail(`${token}: ${entry.lemma} primary meaning is not its first sense`);
    if (!Array.isArray(entry.sourceIds)) fail(`${token}: ${entry.lemma} has no source record list`);
    if (!Array.isArray(entry.metadataVariants)) fail(`${token}: ${entry.lemma} has no metadata variant list`);
    if (new Set(entry.sourceIds).size !== entry.sourceIds.length) fail(`${token}: ${entry.lemma} repeats a source record`);
    if (new Set(entry.metadataVariants.map((metadata) => metadata.code)).size !== entry.metadataVariants.length) {
      fail(`${token}: ${entry.lemma} repeats a metadata variant`);
    }
    for (const metadata of entry.metadataVariants) {
      if (!/^[A-Z?]{5}$/.test(metadata.code)) fail(`${token}: ${entry.lemma} has invalid metadata`);
      const rebuilt = ["age", "area", "geography", "frequency", "source"].map((field) => metadata[field]).join("");
      if (rebuilt !== metadata.code) fail(`${token}: ${entry.lemma} metadata fields do not match its code`);
    }
    if (entry.metadata?.code !== entry.metadataVariants[0]?.code) fail(`${token}: ${entry.lemma} primary metadata is inconsistent`);
    if (entry.forms.some((form) => /\b(?:RON|DJ)\b/.test(form))) fail(`${token}: ${entry.lemma} exposes an imported data fragment`);
  }
}

async function auditCuratedCases() {
  for (const testCase of cases) {
    const entries = await lookupLatinWord(testCase.token);
    validateEntries(testCase.token, entries);
    for (const required of testCase.required ?? []) {
      if (!entries.some((entry) => requiredEntryMatches(entry, required))) {
        fail(`${testCase.token}: missing ${required.partPrefix} ${required.lemma}`);
      }
    }
    for (const prefix of testCase.forbiddenPartPrefixes ?? []) {
      if (entries.some((entry) => entry.part.startsWith(prefix))) fail(`${testCase.token}: unexpectedly returned a ${prefix}`);
    }
    for (const meaning of testCase.forbiddenMeanings ?? []) {
      if (entries.some((entry) => `${entry.meaning} ${entry.note ?? ""}`.includes(meaning))) {
        fail(`${testCase.token}: unexpectedly returned a sense containing ${JSON.stringify(meaning)}`);
      }
    }
  }
}

function sameFamily(stem, inflection) {
  if (!(stem.pos === inflection.pos || stem.pos === "V" && inflection.pos === "VPAR")) return false;
  const [stemClass, stemVariant] = stem.n ?? [];
  const [endingClass, endingVariant] = inflection.n ?? [];
  const strictFirstPronounVariant = stem.pos === "PRON" && stemClass === 1 && endingVariant === 0;
  return (stemClass === endingClass || stemClass === 0 || endingClass === 0) &&
    (stemVariant == null || endingVariant == null || stemVariant === endingVariant || stemVariant === 0 ||
      (!strictFirstPronounVariant && endingVariant === 0));
}

async function auditDataAndRepresentativeRules() {
  const ids = new Set();
  for (const word of words) {
    if (ids.has(word.id)) fail(`duplicate dictionary id ${word.id}`);
    ids.add(word.id);
    if (!/^[A-Z?]{5}$/.test(entryMetadata.codes[word.id - 1] ?? "")) {
      fail(`dictionary id ${word.id} is missing fixed-width metadata`);
    }
  }
  if (entryMetadata.codes.length !== words.length) {
    fail(`metadata contains ${entryMetadata.codes.length} records for ${words.length} dictionary entries`);
  }
  for (const stem of stems) {
    if (!ids.has(stem.wid)) fail(`stem ${stem.orth} refers to missing dictionary id ${stem.wid}`);
  }
  const inflectionKeys = new Set(inflections.map(inflectionKey));
  const importedInflectionKeys = new Set(importedInflections.map(inflectionKey));
  const correctionKeys = inflectionCorrections.map(inflectionKey);
  if (new Set(correctionKeys).size !== correctionKeys.length) fail("inflection corrections contain duplicate rules");
  for (const correctionKey of correctionKeys) {
    if (importedInflectionKeys.has(correctionKey)) fail(`inflection correction duplicates an imported rule: ${correctionKey}`);
  }
  for (const [part, expectedCount] of Object.entries(inflectionSourceManifest.ruleCounts)) {
    const actualCount = inflections.filter((inflection) => inflection.pos === part).length;
    if (actualCount !== expectedCount) {
      fail(`${inflectionSourceManifest.source} defines ${expectedCount} ${part} rules, but the imported data contains ${actualCount}`);
    }
  }
  for (const requiredRule of inflectionSourceManifest.requiredRules) {
    if (!inflectionKeys.has(inflectionKey(requiredRule))) {
      fail(`missing ${inflectionSourceManifest.source} line ${requiredRule.sourceLine}: ${inflectionKey(requiredRule)}`);
    }
  }
  for (const word of words.filter((word) => !word.form?.trim() && word.orth)) {
    const entries = await lookupLatinWord(word.orth);
    const expectedPart = word.pos === "CONJ" ? "conjunction" : "interjection";
    const exactEntry = entries.find((entry) => entry.sourceIds.includes(word.id) &&
      entry.part === expectedPart && entry.lemma === word.orth && entry.forms.includes("indeclinable"));
    if (!exactEntry) {
      fail(`${word.orth}: missing whole-word ${expectedPart} entry`);
    } else {
      const expectedSenses = word.senses.map((sense) => sense.replace(/^\|+/, "").trim()).filter(Boolean);
      if (!expectedSenses.every((sense) => exactEntry.senses.includes(sense))) {
        fail(`${word.orth}: whole-word entry does not preserve every source sense`);
      }
    }
  }

  let regularSecondDeclensionHeadwords = 0;
  for (const word of words.filter((word) => {
    const first = word.parts?.[0] ?? "";
    const gender = word.form.trim().split(/\s+/)[2];
    return word.pos === "N" && word.n?.[0] === 2 && word.n?.[1] === 1 &&
      Boolean(first) && gender !== "N" && first !== "vir" && !/er$/i.test(first);
  })) {
    const token = `${word.parts[0]}us`;
    const genderCode = word.form.trim().split(/\s+/)[2];
    const gender = { M: "masculine", F: "feminine", C: "common gender" }[genderCode];
    const entry = (await lookupLatinWord(token)).find((candidate) =>
      candidate.sourceIds.includes(word.id) && candidate.forms.includes(`nominative · singular · ${gender}`)
    );
    if (!entry) fail(`${token}: regular second-declension source record ${word.id} is not available in the nominative singular`);
    regularSecondDeclensionHeadwords += 1;
  }

  const stemsByPos = new Map();
  for (const stem of stems) stemsByPos.set(stem.pos, [...stemsByPos.get(stem.pos) ?? [], stem]);
  const probes = new Set(cases.map((testCase) => normalize(testCase.token)));
  for (const word of uniques) probes.add(normalize(word.orth));
  let adjectiveDegreeProbes = 0;
  for (const word of words.filter((word) => word.pos === "ADJ" && word.form.trim().split(/\s+/)[2] === "X")) {
    for (const [position, ending, degree] of [[2, "or", "comparative"], [3, "mus", "superlative"]]) {
      const stem = word.parts?.[position];
      if (!stem) continue;
      const token = normalize(`${stem}${ending}`);
      const entry = (await lookupLatinWord(token)).find((candidate) => candidate.sourceIds.includes(word.id));
      if (!entry) {
        fail(`${token}: does not resolve to adjective source record ${word.id}`);
      } else {
        if (!entry.forms.some((form) => form.endsWith(degree))) fail(`${token}: is not labeled ${degree}`);
        if (!entry.lemma.includes(`${stem}${ending}`)) fail(`${token}: ${entry.lemma} omits its ${degree} headword`);
      }
      probes.add(token);
      adjectiveDegreeProbes += 1;
    }
  }
  let exercisedRules = 0;
  for (const inflection of inflections) {
    const possible = [
      ...stemsByPos.get(inflection.pos) ?? [],
      ...(inflection.pos === "VPAR" ? stemsByPos.get("V") ?? [] : [])
    ];
    const stem = possible.find((candidate) => sameFamily(candidate, inflection) && ids.has(candidate.wid));
    if (!stem) continue;
    const token = normalize(`${stem.orth}${inflection.ending}`);
    if (token.length < 2) continue;
    probes.add(token);
    exercisedRules += 1;
  }

  for (const token of probes) validateEntries(token, await lookupLatinWord(token));
  return { probes: probes.size, exercisedRules, adjectiveDegreeProbes, regularSecondDeclensionHeadwords };
}

const partCodes = ["VPAR", "PRON", "INTERJ", "SUPINE", "PREP", "CONJ", "ADJ", "ADV", "NUM", "N", "V"];
const morphologyStarts = new Set(["NOM", "VOC", "GEN", "DAT", "ACC", "ABL", "LOC", "PRES", "IMPF", "PERF", "FUT", "FUTP", "PLUP", "POS", "COMP", "SUPER"]);
const morphologyLengths = { N: 3, PRON: 3, ADJ: 4, NUM: 3, V: 5, VPAR: 6, ADV: 1, PREP: 1, SUPINE: 3 };

function referenceForms(message) {
  const signatures = new Set();
  const pattern = new RegExp(`^\\S+\\s+(${partCodes.join("|")})\\s+(.+)$`);
  for (const line of message.split(/\r?\n/)) {
    const indeclinable = line.match(/^\S+\s+(CONJ|INTERJ)\s*$/);
    if (indeclinable) {
      signatures.add(`${indeclinable[1]}|INDECLINABLE`);
      continue;
    }
    const match = line.match(pattern);
    if (!match) continue;
    const tokens = match[2].trim().replace(/^\d+\s+\d+\s+/, "").split(/\s+/);
    if (!morphologyStarts.has(tokens[0]) || !morphologyLengths[match[1]]) continue;
    const formTokens = tokens.slice(0, morphologyLengths[match[1]]).filter((token) => token !== "X");
    signatures.add(`${match[1]}|${formTokens.join(" ")}`);
    if (match[1] === "ADJ" && formTokens.at(-1) === "POS") {
      signatures.add(`ADJ|${formTokens.slice(0, -1).join(" ")}`);
    }
  }
  return signatures;
}

const formCodes = {
  nominative: "NOM", vocative: "VOC", genitive: "GEN", dative: "DAT", accusative: "ACC", ablative: "ABL", locative: "LOC",
  singular: "S", plural: "P", masculine: "M", feminine: "F", neuter: "N", "common gender": "C",
  present: "PRES", imperfect: "IMPF", perfect: "PERF", future: "FUT", "future perfect": "FUTP", pluperfect: "PLUP",
  active: "ACTIVE", passive: "PASSIVE", indicative: "IND", subjunctive: "SUB", imperative: "IMP", infinitive: "INF", participle: "PPL",
  positive: "POS", comparative: "COMP", superlative: "SUPER", pos: "POS", indeclinable: "INDECLINABLE"
};
const displayPartCodes = [["participle", "VPAR"], ["pronoun", "PRON"], ["preposition", "PREP"], ["adjective", "ADJ"], ["adverb", "ADV"], ["noun", "N"], ["verb", "V"], ["number", "NUM"], ["conjunction", "CONJ"], ["interjection", "INTERJ"], ["supine", "SUPINE"]];

function localSignature(entry, form) {
  const part = displayPartCodes.find(([label]) => entry.part.startsWith(label))?.[1] ?? "?";
  const tokens = form.split(" · ").map((token) => token.match(/^([123])(?:st|nd|rd) person$/)?.[1] ?? formCodes[token] ?? token.toUpperCase());
  return `${part}|${tokens.join(" ")}`;
}

function referenceContainsLocal(signature, reference) {
  if (reference.has(signature)) return true;
  const [part, form] = signature.split("|");
  if (part !== "V" || /ACTIVE|PASSIVE/.test(form)) return false;
  return [...reference].some((candidate) => candidate.startsWith("V|") && candidate.replace(/ (?:ACTIVE|PASSIVE) /, " ") === signature);
}

async function auditAgainstLatinWords() {
  let checked = 0;
  let skipped = 0;
  for (const testCase of cases.filter((candidate) => candidate.referenceHeadwords?.length)) {
    const url = `https://latin-words.com/cgi-bin/translate.cgi?query=${encodeURIComponent(testCase.token)}`;
    const response = await nativeFetch(url);
    if (!response.ok) {
      fail(`${testCase.token}: latin-words.com returned HTTP ${response.status}`);
      continue;
    }
    const payload = await response.json();
    if (payload.status !== "ok") {
      fail(`${testCase.token}: latin-words.com lookup failed: ${payload.message}`);
      continue;
    }
    if (!payload.message.trim()) {
      console.warn(`Live reference skipped ${testCase.token}: latin-words.com returned an empty successful response.`);
      skipped += 1;
      continue;
    }
    checked += 1;
    const reference = referenceForms(payload.message);
    const local = await lookupLatinWord(testCase.token);
    for (const signature of new Set(local.flatMap((entry) => entry.forms.map((form) => localSignature(entry, form))))) {
      if (!referenceContainsLocal(signature, reference)) fail(`${testCase.token}: local form ${signature} is absent from latin-words.com`);
    }
    const normalizedMessage = payload.message.replace(/\s+/g, " ").toLocaleLowerCase();
    for (const headword of testCase.referenceHeadwords ?? []) {
      if (!normalizedMessage.includes(headword.toLocaleLowerCase())) fail(`${testCase.token}: latin-words.com no longer confirms headword ${headword}`);
    }
    for (const entry of local.filter((item) => item.metadata)) {
      const sourceSenses = [...new Set(entry.sourceIds.flatMap((id) => wordsById.get(id)?.senses ?? [])
        .map((sense) => sense.replace(/^\|+/, "").trim()).filter(Boolean))];
      for (const sense of sourceSenses) {
        const normalizedSense = sense.replace(/\s+/g, " ").toLocaleLowerCase();
        if (!normalizedMessage.includes(normalizedSense)) {
          fail(`${testCase.token}: latin-words.com output is missing local sense ${JSON.stringify(sense)}`);
        }
      }
      if (!normalizedMessage.includes(`[${entry.metadata.code.toLocaleLowerCase()}]`)) {
        fail(`${testCase.token}: latin-words.com output is missing metadata [${entry.metadata.code}]`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  return { checked, skipped };
}

await auditCuratedCases();
const coverage = await auditDataAndRepresentativeRules();
const liveCoverage = process.argv.includes("--live") ? await auditAgainstLatinWords() : undefined;

if (errors.length) {
  console.error(`Dictionary audit failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  const liveSummary = liveCoverage ? `, ${liveCoverage.checked} live latin-words.com comparisons${liveCoverage.skipped ? ` (${liveCoverage.skipped} empty reference responses skipped)` : ""}` : "";
  console.log(`Dictionary audit passed: ${cases.length} curated cases, ${coverage.probes} structural probes, ${coverage.adjectiveDegreeProbes} adjective degree links, ${coverage.regularSecondDeclensionHeadwords} regular -us noun headwords, ${coverage.exercisedRules}/${inflections.length} inflection rules exercised${liveSummary}.`);
}
