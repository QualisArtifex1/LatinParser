import type { Definition, Inflection, MorphForm, ParseResponse, TokenResult } from "../types";

type NValue = string | number;

interface RawInflection {
  ending: string;
  pos: string;
  note?: string;
  n: NValue[];
  form: string;
}

interface RawStem {
  orth: string;
  pos: string;
  form: string;
  n: NValue[];
  wid: number;
}

interface RawWord {
  id?: number;
  orth: string;
  parts?: string[];
  pos: string;
  form?: string;
  n?: NValue[];
  senses: string[];
}

interface Addon {
  orth: string;
  pos: string;
  form?: string;
  senses: string[];
}

interface Addons {
  prefixes: Addon[];
  suffixes: Addon[];
  tackons: Addon[];
  packons: Addon[];
  not_packons: Addon[];
}

interface OpenWordsData {
  words: RawWord[];
  stems: RawStem[];
  inflects: RawInflection[];
  uniques: RawWord[];
  addons: Addons;
  customWords: RawWord[];
  customAliases: Record<string, string>;
}

interface MatchStem {
  st: RawStem;
  infls: RawInflection[];
}

interface LookupResult {
  w: RawWord | Addon;
  stems?: MatchStem[];
}

const PUNCTUATION_PATTERN = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g;
let parserPromise: Promise<OpenWordsParser> | null = null;

function dataUrl(fileName: string) {
  return `${import.meta.env.BASE_URL}open-words/${fileName}`;
}

async function fetchJson<T>(fileName: string): Promise<T> {
  const response = await fetch(dataUrl(fileName));
  if (!response.ok) {
    throw new Error(`Could not load ${fileName}`);
  }
  return (await response.json()) as T;
}

async function fetchOptionalJson<T>(fileName: string, fallback: T): Promise<T> {
  const response = await fetch(dataUrl(fileName));
  if (!response.ok) {
    return fallback;
  }
  return (await response.json()) as T;
}

function summarize(tokens: TokenResult[]) {
  const definitions = tokens.reduce((count, token) => count + token.defs.length, 0);
  const forms = tokens.reduce(
    (count, token) =>
      count + token.defs.reduce((definitionCount, definition) => definitionCount + definition.infls.length, 0),
    0
  );

  return {
    tokens: tokens.length,
    matched: tokens.filter((token) => token.defs.length > 0).length,
    definitions,
    forms
  };
}

function cloneWord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sameArray(left?: NValue[], right?: NValue[]) {
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item === right[index]);
}

function stripEnding(word: string, ending: string) {
  return ending ? word.slice(0, -ending.length) : word;
}

function formKey(infl: RawInflection) {
  return infl.form;
}

function normalizedForm(form: string) {
  return form.replace(/\s+/g, " ").trim();
}

function isPresentActiveInfinitive(infl: RawInflection) {
  return infl.pos === "V" && normalizedForm(infl.form) === "PRES ACTIVE INF 0 X";
}

function inflectionPriority(infl: RawInflection) {
  if (isPresentActiveInfinitive(infl)) {
    return 0;
  }

  const form = normalizedForm(infl.form);
  if (form.includes("ACTIVE INF")) {
    return 1;
  }
  if (form.includes("ACTIVE")) {
    return 2;
  }
  if (form.includes("PASSIVE")) {
    return 3;
  }
  return 4;
}

function compareInflections(left: RawInflection, right: RawInflection) {
  return inflectionPriority(left) - inflectionPriority(right) || left.form.localeCompare(right.form);
}

function formattedInflKey(infl: Inflection) {
  return `${infl.pos}|${infl.ending}|${JSON.stringify(infl.form)}`;
}

function definitionMergeKey(definition: Definition) {
  return [
    definition.orth.join("|"),
    definition.entry?.pos ?? "",
    definition.entry?.gender ?? "",
    definition.infls.map(formattedInflKey).sort().join("~")
  ].join("::");
}

function cleanSense(sense: string) {
  return sense.replace(/^\|+/, "");
}

function mergeDefinitionGroups(definitions: Definition[]) {
  const merged: Definition[] = [];
  const mergedByKey = new Map<string, Definition>();

  for (const definition of definitions) {
    const key = definitionMergeKey(definition);
    const existing = mergedByKey.get(key);

    if (!existing) {
      const next = {
        ...definition,
        senses: definition.senses.map(cleanSense)
      };
      mergedByKey.set(key, next);
      merged.push(next);
      continue;
    }

    const seenSenses = new Set(existing.senses);
    for (const sense of definition.senses.map(cleanSense)) {
      if (!seenSenses.has(sense)) {
        seenSenses.add(sense);
        existing.senses.push(sense);
      }
    }
  }

  return merged;
}

function translate(value: string, dictionary: Record<string, string>) {
  return dictionary[value] ?? value;
}

function translateGender(value?: string) {
  return value
    ? translate(value, { M: "masculine", F: "feminine", N: "neuter", C: "common", X: "" })
    : "";
}

function isRawWord(value: RawWord | Addon): value is RawWord {
  return "parts" in value || "id" in value || "n" in value;
}

function localizeIForJ(value: string) {
  return value.replace(/j/g, "i").replace(/J/g, "I");
}

function localizeLookupIForJ(lookup: LookupResult): LookupResult {
  const rawWord = lookup.w;
  if (!isRawWord(rawWord)) {
    return lookup;
  }

  return {
    ...lookup,
    w: {
      ...rawWord,
      orth: localizeIForJ(rawWord.orth),
      parts: rawWord.parts?.map(localizeIForJ)
    }
  };
}

function iToJVariant(word: string) {
  return word.startsWith("iu") ? `ju${word.slice(2)}` : "";
}

function capitalizeLowercase(word: string) {
  const lower = word.toLowerCase();
  return lower ? `${lower[0].toUpperCase()}${lower.slice(1)}` : "";
}

function lookupVariants(word: string) {
  return Array.from(new Set([word, word.toLowerCase(), capitalizeLowercase(word)].filter(Boolean)));
}

function wordKey(word: RawWord) {
  return `${word.parts?.join("|") ?? ""}|${word.n?.join(".") ?? ""}|${word.form ?? ""}`;
}

function verbPrincipalPartIndexes(word: RawWord, stem: RawStem) {
  return word.parts?.reduce<number[]>((indexes, part, index) => {
    if (part === stem.orth) {
      indexes.push(index);
    }
    return indexes;
  }, []) ?? [];
}

function isPerfectSystem(form: string) {
  return form.startsWith("PERF") || form.startsWith("PLUP") || form.startsWith("FUTP");
}

function verbKind(word: RawWord) {
  return word.form?.split(/\s+/)[2] ?? "";
}

function isDeponentVerb(word: RawWord) {
  return verbKind(word) === "DEP";
}

function isInvariantPartOfSpeech(pos: string) {
  return ["ADV", "PREP", "CONJ", "INTERJ"].includes(pos);
}

function isInvariantCompatible(word: RawWord | undefined, stem: RawStem, infl: RawInflection) {
  if (!isInvariantPartOfSpeech(stem.pos)) {
    return true;
  }

  if (infl.ending !== "" || infl.pos !== stem.pos) {
    return false;
  }

  if (!word?.form) {
    return true;
  }

  return normalizedForm(infl.form).startsWith(normalizedForm(word.form));
}

function lookupPriority(lookup: LookupResult) {
  const inflections = lookup.stems?.flatMap((stem) => stem.infls) ?? [];

  if (inflections.some(isPresentActiveInfinitive)) {
    return 0;
  }
  if (inflections.some((infl) => normalizedForm(infl.form).includes("ACTIVE INF"))) {
    return 1;
  }
  return 2;
}

function isParadigmCompatible(infl: RawInflection, stem: RawStem) {
  if (isInvariantPartOfSpeech(stem.pos)) {
    return true;
  }

  const isPrimaryMatch = infl.n[0] === 0 || stem.n[0] === 0 || infl.n[0] === stem.n[0];
  if (!isPrimaryMatch) {
    return false;
  }

  if (!["N", "ADJ", "PRON", "NUM", "V", "VPAR"].includes(stem.pos)) {
    return true;
  }

  return infl.n[1] === 0 || stem.n[1] === 0 || infl.n[1] === stem.n[1];
}

function dictionaryGender(word: RawWord) {
  return word.form?.split(/\s+/)[2] ?? "";
}

function inflectionGender(infl: RawInflection) {
  return infl.form.split(/\s+/)[2] ?? "";
}

function isGenderCompatible(wordGender: string, inflGender: string) {
  if (!wordGender || !inflGender || wordGender === "X" || inflGender === "X") {
    return true;
  }
  if (wordGender === inflGender) {
    return true;
  }
  if (inflGender === "C") {
    return wordGender === "M" || wordGender === "F" || wordGender === "C";
  }
  if (wordGender === "C") {
    return inflGender === "M" || inflGender === "F";
  }
  return false;
}

function isOrdinaryNounForm(word: RawWord, infl: RawInflection) {
  if (!isGenderCompatible(dictionaryGender(word), inflectionGender(infl))) {
    return false;
  }

  if (sameArray(word.n, [2, 1]) && infl.form === "NOM S C" && infl.ending === "os") {
    return false;
  }

  if (word.n?.[0] === 3 && infl.form === "DAT S X" && infl.ending === "e") {
    return false;
  }

  return true;
}

function isEoIreStemForm(word: RawWord, stem: RawStem, infl: RawInflection) {
  if (!sameArray(word.n, [6, 1]) || infl.note !== "eo_ire") {
    return true;
  }

  const partIndexes = verbPrincipalPartIndexes(word, stem);
  if (!partIndexes.includes(0) || stem.orth !== "e" || !infl.form.startsWith("PRES  ACTIVE  IND")) {
    return true;
  }

  return ["PRES  ACTIVE  IND  1 S", "PRES  ACTIVE  IND  3 P"].includes(infl.form);
}

const SUPPLEMENTAL_INFLECTIONS: RawInflection[] = [
  { ending: "us", pos: "N", note: "", n: [2, 1], form: "NOM S X" },
  { ending: "mus", pos: "ADJ", note: "superlative", n: [0, 0], form: "NOM S M SUPER" },
  { ending: "mi", pos: "ADJ", note: "superlative", n: [0, 0], form: "GEN S M SUPER" },
  { ending: "mo", pos: "ADJ", note: "superlative", n: [0, 0], form: "DAT S M SUPER" },
  { ending: "mum", pos: "ADJ", note: "superlative", n: [0, 0], form: "ACC S M SUPER" },
  { ending: "mo", pos: "ADJ", note: "superlative", n: [0, 0], form: "ABL S M SUPER" },
  { ending: "me", pos: "ADJ", note: "superlative", n: [0, 0], form: "VOC S M SUPER" },
  { ending: "mi", pos: "ADJ", note: "superlative", n: [0, 0], form: "NOM P M SUPER" },
  { ending: "morum", pos: "ADJ", note: "superlative", n: [0, 0], form: "GEN P M SUPER" },
  { ending: "mis", pos: "ADJ", note: "superlative", n: [0, 0], form: "DAT P X SUPER" },
  { ending: "mos", pos: "ADJ", note: "superlative", n: [0, 0], form: "ACC P M SUPER" },
  { ending: "mis", pos: "ADJ", note: "superlative", n: [0, 0], form: "ABL P X SUPER" },
  { ending: "mi", pos: "ADJ", note: "superlative", n: [0, 0], form: "VOC P M SUPER" },
  { ending: "ma", pos: "ADJ", note: "superlative", n: [0, 0], form: "NOM S F SUPER" },
  { ending: "mae", pos: "ADJ", note: "superlative", n: [0, 0], form: "GEN S F SUPER" },
  { ending: "mae", pos: "ADJ", note: "superlative", n: [0, 0], form: "DAT S F SUPER" },
  { ending: "mam", pos: "ADJ", note: "superlative", n: [0, 0], form: "ACC S F SUPER" },
  { ending: "ma", pos: "ADJ", note: "superlative", n: [0, 0], form: "ABL S F SUPER" },
  { ending: "ma", pos: "ADJ", note: "superlative", n: [0, 0], form: "VOC S F SUPER" },
  { ending: "mae", pos: "ADJ", note: "superlative", n: [0, 0], form: "NOM P F SUPER" },
  { ending: "marum", pos: "ADJ", note: "superlative", n: [0, 0], form: "GEN P F SUPER" },
  { ending: "mas", pos: "ADJ", note: "superlative", n: [0, 0], form: "ACC P F SUPER" },
  { ending: "mae", pos: "ADJ", note: "superlative", n: [0, 0], form: "VOC P F SUPER" },
  { ending: "mum", pos: "ADJ", note: "superlative", n: [0, 0], form: "NOM S N SUPER" },
  { ending: "mi", pos: "ADJ", note: "superlative", n: [0, 0], form: "GEN S N SUPER" },
  { ending: "mo", pos: "ADJ", note: "superlative", n: [0, 0], form: "DAT S N SUPER" },
  { ending: "mum", pos: "ADJ", note: "superlative", n: [0, 0], form: "ACC S N SUPER" },
  { ending: "mo", pos: "ADJ", note: "superlative", n: [0, 0], form: "ABL S N SUPER" },
  { ending: "mum", pos: "ADJ", note: "superlative", n: [0, 0], form: "VOC S N SUPER" },
  { ending: "ma", pos: "ADJ", note: "superlative", n: [0, 0], form: "NOM P N SUPER" },
  { ending: "morum", pos: "ADJ", note: "superlative", n: [0, 0], form: "GEN P N SUPER" },
  { ending: "ma", pos: "ADJ", note: "superlative", n: [0, 0], form: "ACC P N SUPER" },
  { ending: "ma", pos: "ADJ", note: "superlative", n: [0, 0], form: "VOC P N SUPER" }
];

const PRONOUN_LEMMA_OVERRIDES: Record<string, string[]> = {
  "aliqu|alicu|1.0|1 0 INDEF": ["aliquis", "aliqua", "aliquid"],
  "aliqu|alicu|1.0|1 0 ADJECT": ["aliqui", "aliqua", "aliquod"],
  "aliqu||1.1|1 1 ADJECT": ["aliqui"],
  "aliqu||1.2|1 2 INDEF": ["aliquis"],
  "aliqu||1.3|1 3 INDEF": ["aliqua"],
  "aliqu||1.3|1 3 ADJECT": ["aliqua"],
  "aliqu||1.6|1 6 INDEF": ["aliquid"],
  "aliqu||1.6|1 6 ADJECT": ["aliquid"],
  "aliqu||1.7|1 7 INDEF": ["aliquod"],
  "aliqu||1.7|1 7 ADJECT": ["aliquod"],
  "eccill|eccill|6.1|6 1 ADJECT": ["eccille", "eccillius"],
  "ego|m|5.1|5 1 PERS": ["ego", "mei"],
  "h|hu|3.1|3 1 ADJECT": ["hic", "haec", "hoc"],
  "i|e|4.1|4 1 PERS": ["is", "ea", "id"],
  "i|e|4.2|4 2 DEMONS": ["idem", "eadem", "idem"],
  "ill|ill|6.1|6 1 ADJECT": ["ille", "illa", "illud"],
  "ips|ips|6.2|6 2 X": ["ipse", "ipsa", "ipsum"],
  "iss|iss|6.2|6 2 X": ["ipsus", "ipsa", "ipsum"],
  "ist|ist|6.1|6 1 DEMONS": ["iste", "ista", "istud"],
  "ist|istu|3.1|3 1 DEMONS": ["istic", "istaec", "istuc"],
  "n|nostr|5.3|5 3 PERS": ["nos", "nostri"],
  "oll|oll|6.1|6 1 ADJECT": ["olle", "olla", "ollud"],
  "qu|cu|1.0|1 0 REL": ["qui", "quae", "quod"],
  "qu|cu|1.0|1 0 INTERR": ["quis", "quid"],
  "qu|cu|1.0|1 0 INDEF": ["quis", "quid"],
  "qu|cu|1.0|1 0 ADJECT": ["qui", "quae", "quod"],
  "qu||1.1|1 1 REL": ["qui"],
  "qu||1.1|1 1 INDEF": ["qui"],
  "qu||1.1|1 1 ADJECT": ["qui"],
  "qu||1.2|1 2 INTERR": ["quis"],
  "qu||1.2|1 2 INDEF": ["quis"],
  "qu||1.3|1 3 INDEF": ["qua"],
  "qu||1.3|1 3 ADJECT": ["qua"],
  "qu||1.4|1 4 REL": ["quae"],
  "qu||1.4|1 4 INDEF": ["quae"],
  "qu||1.4|1 4 ADJECT": ["quae"],
  "qu||1.6|1 6 INTERR": ["quid"],
  "qu||1.6|1 6 INDEF": ["quid"],
  "qu||1.7|1 7 REL": ["quod"],
  "qu||1.7|1 7 INDEF": ["quod"],
  "qu||1.7|1 7 ADJECT": ["quod"],
  "qu||1.8|1 8 INDEF": ["quae"],
  "qu||1.8|1 8 ADJECT": ["quae"],
  "qu||1.9|1 9 REL": ["qua"],
  "qu||1.9|1 9 INTERR": ["qua"],
  "qu||1.9|1 9 INDEF": ["qua"],
  "qu||1.9|1 9 ADJECT": ["qua"],
  "seips|seips|6.2|6 2 DEMONS": ["seipse", "seipsa", "seipsum"],
  "semetips|semetips|6.2|6 2 DEMONS": ["semetipse", "semetipsa", "semetipsum"],
  "tu|t|5.2|5 2 PERS": ["tu", "tui"],
  "v|vestr|5.3|5 3 PERS": ["vos", "vestri"],
  "v|vostr|5.3|5 3 PERS": ["vos", "vostri"],
  "|s|5.4|5 4 REFLEX": ["sui"]
};

const NOUN_LEMMA_OVERRIDES: Record<string, string[]> = {
  "itiner|itiner|3.2|3 2 N T": ["iter", "itineris"]
};

class OpenWordsParser {
  private wordsById = new Map<number, RawWord>();
  private stemsByOrth = new Map<string, RawStem[]>();
  private uniquesByOrth = new Map<string, RawWord>();
  private inflects: RawInflection[];

  constructor(private data: OpenWordsData) {
    this.inflects = [...data.inflects, ...SUPPLEMENTAL_INFLECTIONS].sort(
      (left, right) => left.ending.length - right.ending.length
    );

    for (const word of data.words) {
      if (typeof word.id === "number") {
        this.wordsById.set(word.id, word);
      }
    }

    for (const stem of data.stems) {
      const stems = this.stemsByOrth.get(stem.orth);
      if (stems) {
        stems.push(stem);
      } else {
        this.stemsByOrth.set(stem.orth, [stem]);
      }
    }

    for (const unique of data.uniques) {
      this.uniquesByOrth.set(unique.orth, unique);
    }

    for (const customWord of data.customWords) {
      this.uniquesByOrth.set(customWord.orth, customWord);
    }
  }

  parseLine(line: string): TokenResult[] {
    return this.sanitize(line)
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => this.parse(word));
  }

  private parse(input: string): TokenResult {
    return {
      word: input,
      defs: this.formatOutput(this.latinToEnglish(input))
    };
  }

  private latinToEnglish(input: string): LookupResult[] {
    for (const variant of lookupVariants(input)) {
      const [word, addons] = this.splitEnclitic(variant);
      const unique = this.uniquesByOrth.get(word);

      if (unique) {
        return [{ w: unique, stems: [] }, ...addons];
      }

      const direct = this.findForms(word);
      if (direct.length > 0) {
        return [...direct, ...addons];
      }

      const alias = this.data.customAliases[word] ?? iToJVariant(word);
      if (alias) {
        const aliasResults = this.findForms(alias).map(localizeLookupIForJ);
        if (aliasResults.length > 0) {
          return [...aliasResults, ...addons];
        }
      }

      if (addons.length > 0) {
        return addons;
      }
    }

    return [];
  }

  private findForms(word: string, reduced = false): LookupResult[] {
    const inflections = this.inflects.filter((infl) => word.endsWith(infl.ending));
    const stems = this.checkStems(word, inflections);
    const out = this.lookupStems(stems, [], !reduced);

    if (out.length === 0 && !reduced) {
      const reducedOut = this.reduce(word);
      if (reducedOut) {
        out.push(...reducedOut);
      }
    }

    return out;
  }

  private checkStems(word: string, inflections: RawInflection[]) {
    const matchStems: MatchStem[] = [];

    for (const infl of inflections) {
      const stemOrth = stripEnding(word, infl.ending);
      const stems = this.stemsByOrth.get(stemOrth) ?? [];

      for (const stem of stems) {
        const rawWord = this.wordsById.get(stem.wid);
        const isPosMatch = infl.pos === stem.pos || (infl.pos === "VPAR" && stem.pos === "V");
        const isParadigmMatch = isParadigmCompatible(infl, stem);
        const isInvariantMatch = isInvariantCompatible(rawWord, stem, infl);
        const isStemCompatible = rawWord ? this.isCompatibleStem(rawWord, stem, infl) : true;

        if (!isPosMatch || !isParadigmMatch || !isInvariantMatch || !isStemCompatible) {
          continue;
        }

        const existing = matchStems.find((candidate) => candidate.st === stem);
        if (existing) {
          if (!existing.infls.some((stemInfl) => formKey(stemInfl) === formKey(infl))) {
            existing.infls.push(infl);
          }
        } else {
          matchStems.push({ st: stem, infls: [infl] });
        }
      }
    }

    return matchStems;
  }

  private isCompatibleStem(word: RawWord, stem: RawStem, infl: RawInflection) {
    if (stem.pos === "N" && infl.pos === "N") {
      return isOrdinaryNounForm(word, infl);
    }

    if (stem.pos !== "V" || !word.parts) {
      return true;
    }

    const partIndexes = verbPrincipalPartIndexes(word, stem);

    if (infl.pos === "VPAR") {
      return partIndexes.includes(3);
    }

    if (infl.pos !== "V") {
      return true;
    }

    if (isDeponentVerb(word) && infl.form.includes("ACTIVE")) {
      return false;
    }

    if (!isEoIreStemForm(word, stem, infl)) {
      return false;
    }

    if (isPerfectSystem(infl.form)) {
      return partIndexes.includes(2);
    }

    if (partIndexes.includes(3)) {
      return false;
    }

    return partIndexes.includes(0) || partIndexes.includes(1);
  }

  private lookupStems(matchStems: MatchStem[], out: LookupResult[], getWordEnds = true) {
    for (const matchStem of matchStems) {
      const word = this.wordsById.get(matchStem.st.wid);
      if (!word) {
        continue;
      }

      const existing = out.find((candidate) => {
        const existingWord = candidate.w;
        return isRawWord(existingWord) && existingWord.id === word.id;
      });

      if (existing?.stems) {
        if (!existing.stems.some((stem) => stem.st === matchStem.st)) {
          existing.stems.push(matchStem);
        }
        continue;
      }

      let stemForWord: MatchStem = { st: matchStem.st, infls: [...matchStem.infls] };
      if (word.pos === "V") {
        const principlePartIndex = word.parts?.indexOf(stemForWord.st.orth) ?? -1;
        stemForWord = this.removeExtraInfls(stemForWord, principlePartIndex === 3 ? "V" : "VPAR");
      }

      let wordClone = cloneWord(word);
      if (getWordEnds) {
        wordClone = this.getWordEndings(wordClone);
      }

      out.push({ w: wordClone, stems: [stemForWord] });
    }

    return out;
  }

  private splitEnclitic(input: string): [string, LookupResult[]] {
    let word = input;
    const out: LookupResult[] = [];

    for (const tackon of this.data.addons.tackons) {
      if (word.endsWith(tackon.orth)) {
        if (word !== "est" && word !== tackon.orth) {
          out.push({ w: { ...tackon, form: tackon.orth }, stems: [] });
          word = stripEnding(word, tackon.orth);
        }
        break;
      }
    }

    const packons = word.startsWith("qu") ? this.data.addons.packons : this.data.addons.not_packons;
    for (const packon of packons) {
      if (word !== packon.orth && word.endsWith(packon.orth)) {
        out.push({ w: packon });
        word = stripEnding(word, packon.orth);
        break;
      }
    }

    return [word, out];
  }

  private getWordEndings(word: RawWord): RawWord {
    let endOne = false;
    let endTwo = false;
    let endThree = false;
    let endFour = false;
    const lenParts = word.parts?.length ?? 0;

    if (word.pos === "PRON") {
      const override = PRONOUN_LEMMA_OVERRIDES[wordKey(word)];
      if (override) {
        word.parts = override;
        return word;
      }
    }

    if (word.pos === "N") {
      const override = NOUN_LEMMA_OVERRIDES[wordKey(word)];
      if (override) {
        word.parts = override;
        return word;
      }
    }

    if (word.pos === "N" && sameArray(word.n, [2, 1]) && word.parts) {
      const gender = word.form?.split(/\s+/)[2];
      if ((gender === "M" || gender === "C" || gender === "X") && word.parts[0] && word.parts[0] !== "-") {
        word.parts[0] += "us";
        endOne = true;
      }
      if (lenParts > 1 && word.parts[1] && word.parts[1] !== "-") {
        word.parts[1] += "i";
        endTwo = true;
      }
    }

    if (word.pos === "N" && word.n?.[0] === 3 && word.parts) {
      if (lenParts > 0 && word.parts[0] && word.parts[0] !== "-") {
        endOne = true;
      }
      if (lenParts > 1 && word.parts[1] && word.parts[1] !== "-") {
        word.parts[1] += "is";
        endTwo = true;
      }
    }

    if (word.pos === "N" && word.n?.[0] === 4 && word.parts) {
      const nominativeEnding = word.n[1] === 2 ? "u" : "us";
      if (lenParts > 0 && word.parts[0] && word.parts[0] !== "-") {
        word.parts[0] += nominativeEnding;
        endOne = true;
      }
      if (lenParts > 1 && word.parts[1] && word.parts[1] !== "-") {
        word.parts[1] += "us";
        endTwo = true;
      }
    }

    if (word.pos === "N" && word.n?.[0] === 5 && word.parts) {
      if (lenParts > 0 && word.parts[0] && word.parts[0] !== "-") {
        word.parts[0] += "es";
        endOne = true;
      }
      if (lenParts > 1 && word.parts[1] && word.parts[1] !== "-") {
        word.parts[1] += "ei";
        endTwo = true;
      }
    }

    if (word.pos === "ADJ" && sameArray(word.n, [3, 2]) && word.parts) {
      if (lenParts > 0 && word.parts[0] && word.parts[0] !== "-") {
        word.parts[0] += "is";
        endOne = true;
      }
      if (lenParts > 1 && word.parts[1] && word.parts[1] !== "-") {
        word.parts[1] += "e";
        endTwo = true;
      }
      if (lenParts > 2 && word.parts[2] && word.parts[2] !== "-") {
        word.parts[2] += "or";
        endThree = true;
      }
      if (lenParts > 3 && word.parts[3] && word.parts[3] !== "-") {
        word.parts[3] += "mus";
        endFour = true;
      }
    }

    for (const infl of this.inflects) {
      const isSameParadigm = sameArray(infl.n, word.n);
      const isSamePos = infl.pos === word.pos || (["V", "VPAR"].includes(infl.pos) && ["V", "VPAR"].includes(word.pos));

      if (!isSameParadigm || !isSamePos || !word.parts) {
        continue;
      }

      if (word.pos === "V" || word.pos === "VPAR") {
        if (lenParts > 0 && !endOne && word.parts[0] && word.parts[0] !== "-" && infl.form === "PRES  ACTIVE  IND  1 S") {
          word.parts[0] += infl.ending;
          endOne = true;
        }
        if (lenParts > 1 && !endTwo && word.parts[1] && word.parts[1] !== "-" && infl.form === "PRES  ACTIVE  INF  0 X") {
          word.parts[1] += infl.ending;
          endTwo = true;
        }
        if (lenParts > 2 && !endThree && word.parts[2] && word.parts[2] !== "-" && infl.form === "PERF  ACTIVE  IND  1 S") {
          word.parts[2] += infl.ending;
          endThree = true;
        }
        if (lenParts > 3 && !endFour && word.parts[3] && word.parts[3] !== "-" && infl.form === "NOM S M PRES PASSIVE PPL") {
          word.parts[3] += infl.ending;
          endFour = true;
        }
      } else if (["N", "ADJ", "PRON"].includes(word.pos)) {
        if (lenParts > 0 && !endOne && word.parts[0] && word.parts[0] !== "-" && infl.form.startsWith("NOM S")) {
          word.parts[0] += infl.ending;
          endOne = true;
        }
        if (lenParts > 1 && !endTwo && word.parts[1] && word.parts[1] !== "-" && infl.form.startsWith("GEN S")) {
          word.parts[1] += infl.ending;
          endTwo = true;
        }
      }
    }

    if ((word.pos === "V" || word.pos === "VPAR") && word.parts) {
      if (lenParts > 0 && !endOne && word.parts[0] && word.parts[0] !== "-") {
        word.parts[0] += "o";
      }
      if (lenParts > 1 && !endTwo && word.parts[1] && word.parts[1] !== "-") {
        word.parts[1] += "?re";
      }
      if (lenParts > 2 && !endThree && word.parts[2] && word.parts[2] !== "-") {
        word.parts[2] += "i";
      }
      if (lenParts > 3 && !endFour && word.parts[3] && word.parts[3] !== "-") {
        word.parts[3] += "us";
      }
    }

    return word;
  }

  private sanitize(input: string) {
    return input.replace(PUNCTUATION_PATTERN, " ").replace(/—/g, " ").replace(/\d/g, " ");
  }

  private reduce(word: string): LookupResult[] | false {
    let reduced = word;

    for (const prefix of this.data.addons.prefixes) {
      if (reduced.startsWith(prefix.orth)) {
        reduced = reduced.slice(prefix.orth.length);
        break;
      }
    }

    for (const suffix of this.data.addons.suffixes) {
      if (reduced.endsWith(suffix.orth)) {
        reduced = stripEnding(reduced, suffix.orth);
        break;
      }
    }

    const out = this.findForms(reduced, true);
    return out.some((lookup) => lookup.stems && lookup.stems.length > 0) ? out : false;
  }

  private removeExtraInfls(stem: MatchStem, removeType = "VPAR"): MatchStem {
    return {
      ...stem,
      infls: stem.infls.filter((infl) => infl.pos !== removeType)
    };
  }

  private formatOutput(out: LookupResult[]): Definition[] {
    const definitions = [...out].sort((left, right) => lookupPriority(left) - lookupPriority(right)).map((word) => {
      const rawWord = word.w;
      const obj: Definition = {
        orth: isRawWord(rawWord) && rawWord.parts ? rawWord.parts : [rawWord.orth],
        senses: rawWord.senses,
        infls: [],
        entry: isRawWord(rawWord)
          ? {
              pos: this.formatPartOfSpeech(rawWord.pos),
              gender: rawWord.pos === "N" ? translateGender(dictionaryGender(rawWord)) : undefined
            }
          : undefined
      };

      if (word.stems) {
        for (const stem of word.stems) {
          const seenRawForms = new Set<string>();
          const inflsToAdd: Inflection[] = [];

          for (const infl of [...stem.infls].sort(compareInflections)) {
            if (!seenRawForms.has(infl.form)) {
              seenRawForms.add(infl.form);
              inflsToAdd.push({
                ending: infl.ending,
                pos: infl.pos,
                form: this.formatForm(infl.form, infl.pos)
              });
            }
          }

          const seenFormatted = new Set(obj.infls.map(formattedInflKey));
          for (const infl of inflsToAdd) {
            const key = formattedInflKey(infl);
            if (!seenFormatted.has(key)) {
              seenFormatted.add(key);
              obj.infls.push(infl);
            }
          }
        }
      }

      if (obj.infls.length === 0) {
        obj.infls = [
          {
            form: this.formatForm(rawWord.form ?? rawWord.pos, rawWord.pos),
            ending: "",
            pos: rawWord.pos
          }
        ];
      }

      return this.formatMorph(obj);
    });

    return mergeDefinitionGroups(definitions);
  }

  private formatMorph(word: Definition): Definition {
    return {
      ...word,
      infls: word.infls.map((infl) => ({
        ...infl,
        pos: this.formatPartOfSpeech(infl.pos)
      }))
    };
  }

  private formatPartOfSpeech(pos: string) {
    const partsOfSpeech: Record<string, string> = {
      N: "noun",
      V: "verb",
      VPAR: "participle",
      ADJ: "adjective",
      ADV: "adverb",
      PREP: "preposition",
      PRON: "pronoun",
      INTERJ: "interjection",
      NUM: "number",
      CONJ: "conjunction"
    };

    return partsOfSpeech[pos] ?? pos;
  }

  private formatForm(form: string, pos: string): MorphForm {
    if (["N", "PRON", "ADJ", "NUM"].includes(pos)) {
      const parts = form.split(" ");
      if (parts.length === 3) {
        return {
          declension: translate(parts[0], {
            NOM: "nominative",
            VOC: "vocative",
            GEN: "genitive",
            DAT: "dative",
            ACC: "accusative",
            LOC: "locative",
            ABL: "ablative",
            X: ""
          }),
          number: translate(parts[1], { S: "singular", P: "plural", X: "" }),
          gender: translate(parts[2], { M: "masculine", F: "feminine", N: "neuter", C: "C", X: "" })
        };
      }
      return { form: parts };
    }

    if (pos === "V" && form.length === 22) {
      return {
        tense: translate(form.slice(0, 6).trim(), {
          PRES: "present",
          IMPF: "imperfect",
          PERF: "perfect",
          FUT: "future",
          FUTP: "future perfect",
          PLUP: "pluperfect",
          INF: "infinitive",
          X: ""
        }),
        voice: translate(form.slice(6, 14).trim(), { ACTIVE: "active", PASSIVE: "passive", X: "" }),
        mood: translate(form.slice(14, 19).trim(), { IND: "indicative", SUB: "subjunctive", IMP: "imperative", INF: "infinitive", X: "" }),
        person: Number.parseInt(form.slice(19, 21).trim(), 10),
        number: translate(form.slice(21).trim(), { S: "singular", P: "plural", X: "" })
      };
    }

    if (pos === "VPAR" && form.length === 24) {
      return {
        declension: translate(form.slice(0, 4).trim(), {
          NOM: "nominative",
          VOC: "vocative",
          GEN: "genitive",
          DAT: "dative",
          ACC: "accusative",
          LOC: "locative",
          ABL: "ablative",
          X: ""
        }),
        number: translate(form.slice(4, 6).trim(), { S: "singular", P: "plural", X: "" }),
        gender: translate(form.slice(6, 8).trim(), { M: "masculine", F: "feminine", N: "neuter", C: "C", X: "" }),
        tense: translate(form.slice(8, 13).trim(), {
          PRES: "present",
          IMPF: "imperfect",
          PERF: "perfect",
          FUT: "future",
          FUTP: "future perfect",
          PLUP: "pluperfect",
          INF: "infinitive",
          X: ""
        }),
        voice: translate(form.slice(13, 21).trim(), { ACTIVE: "active", PASSIVE: "passive", X: "" })
      };
    }

    return { form };
  }
}

async function loadOpenWordsParser() {
  const [words, stems, inflects, uniques, addons, customWords, customAliases] = await Promise.all([
    fetchJson<RawWord[]>("words.json"),
    fetchJson<RawStem[]>("stems.json"),
    fetchJson<RawInflection[]>("inflects.json"),
    fetchJson<RawWord[]>("uniques.json"),
    fetchJson<Addons>("addons.json"),
    fetchOptionalJson<RawWord[]>("custom-words.json", []),
    fetchOptionalJson<Record<string, string>>("custom-aliases.json", {})
  ]);

  return new OpenWordsParser({ words, stems, inflects, uniques, addons, customWords, customAliases });
}

export function getOpenWordsParser() {
  parserPromise ??= loadOpenWordsParser();
  return parserPromise;
}

export async function parseLatinText(input: string): Promise<ParseResponse> {
  const text = input.trim();
  const tokens = text ? (await getOpenWordsParser()).parseLine(text) : [];

  return {
    input,
    tokens,
    stats: summarize(tokens),
    generated_at: new Date().toISOString()
  };
}
