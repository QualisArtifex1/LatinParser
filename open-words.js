const DATA_ROOT = "./open-words";
const PARTS = {
  N: "noun",
  V: "verb",
  VPAR: "participle",
  ADJ: "adjective",
  ADV: "adverb",
  PREP: "preposition",
  PRON: "pronoun",
  INTERJ: "interjection",
  NUM: "number",
  CONJ: "conjunction",
  SUPINE: "supine"
};
const FORM_WORDS = {
  NOM: "nominative",
  VOC: "vocative",
  GEN: "genitive",
  DAT: "dative",
  ACC: "accusative",
  ABL: "ablative",
  LOC: "locative",
  S: "singular",
  P: "plural",
  M: "masculine",
  F: "feminine",
  N: "neuter",
  C: "common gender",
  PRES: "present",
  IMPF: "imperfect",
  PERF: "perfect",
  FUT: "future",
  FUTP: "future perfect",
  PLUP: "pluperfect",
  ACTIVE: "active",
  PASSIVE: "passive",
  IND: "indicative",
  SUB: "subjunctive",
  IMP: "imperative",
  INF: "infinitive",
  PPL: "participle"
};
function normalize(value) {
  return value.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/j/g, "i").replace(/v/g, "u").replace(/[^a-z]/g, "");
}
function sameInflectionFamily(stem, inflection) {
  if (!(stem.pos === inflection.pos || stem.pos === "V" && inflection.pos === "VPAR")) return false;
  if (!stem.n || !inflection.n) return true;
  const [stemClass, stemVariant] = stem.n;
  const [endingClass, endingVariant] = inflection.n;
  const classMatches = stemClass === endingClass || stemClass === 0 || endingClass === 0;
  const variantMatches = stemVariant == null || endingVariant == null || stemVariant === endingVariant || stemVariant === 0 || endingVariant === 0;
  return classMatches && variantMatches;
}
function genderMatches(word, inflection) {
  if (word.pos !== "N" || inflection.pos !== "N") return true;
  const wordGender = word.form.trim().split(/\s+/)[2];
  const endingGender = inflection.form.trim().split(/\s+/)[2];
  if (!endingGender || endingGender === "X") return true;
  if (endingGender === "C") return wordGender !== "N";
  return wordGender === endingGender;
}
function formatForm(form, pos) {
  const words = form.trim().split(/\s+/).filter(Boolean);
  const personIndex = pos === "V" ? words.findIndex((word) => /^[123]$/.test(word)) : -1;
  return words.map((word, index) => {
    if (index === personIndex) return `${word}${word === "1" ? "st" : word === "2" ? "nd" : "rd"} person`;
    return FORM_WORDS[word] ?? word.toLocaleLowerCase();
  }).filter((word) => word !== "x" && (pos === "V" || !/^\d+$/.test(word))).join(" \xB7 ");
}
function genderName(word) {
  if (word.pos !== "N") return "";
  const gender = word.form.trim().split(/\s+/)[2];
  return { M: "masculine", F: "feminine", N: "neuter", C: "common gender" }[gender] ?? "";
}
function formatLemma(word) {
  const parts = (word.parts?.filter(Boolean) ?? [word.orth]).map((part) => part.trim());
  if (word.id == null && parts.length > 1) return parts.join(", ");
  const declension = Number(word.n?.[0] ?? 0);
  if (word.pos === "N") {
    const [first = word.orth, second = first] = parts;
    const gender = genderName(word);
    if (declension === 1) return `${first}a, ${second}ae`;
    if (declension === 2) {
      const nominative = first === "vir" || /er$/i.test(first) ? first : `${first}${gender === "neuter" ? "um" : "us"}`;
      return `${nominative}, ${second}i`;
    }
    if (declension === 3) return `${first}, ${second}is`;
    if (declension === 4) return `${first}us, ${second}us`;
    if (declension === 5) return `${first}es, ${second}ei`;
  }
  if (word.pos === "V") {
    const [present = word.orth, infinitive = present, perfect = "", participle = ""] = parts;
    const presentEnding = declension === 2 ? "eo" : "o";
    const infinitiveEnding = declension === 1 ? "are" : declension === 2 ? "ere" : declension === 4 ? "ire" : "ere";
    return [
      `${present}${presentEnding}`,
      `${infinitive}${infinitiveEnding}`,
      perfect ? `${perfect}i` : "",
      participle ? `${participle}us` : ""
    ].filter(Boolean).join(", ");
  }
  if (word.pos === "ADJ" && declension === 1) {
    const first = parts[0] ?? word.orth;
    return `${first}us, ${first}a, ${first}um`;
  }
  return parts.join(", ") || word.orth;
}
function toEntry(word, forms, suffixNote) {
  const gender = genderName(word);
  const part = [PARTS[word.pos] ?? word.pos.toLocaleLowerCase(), gender].filter(Boolean).join(" \xB7 ");
  const senses = word.senses.map((sense) => sense.replace(/^\|/, "").trim()).filter(Boolean);
  const extra = senses.slice(1, 4).join("; ");
  return {
    id: `${word.id ?? word.orth}-${word.pos}-${word.form}`,
    lemma: formatLemma(word),
    part,
    meaning: senses[0] ?? "Definition unavailable",
    note: [extra, suffixNote].filter(Boolean).join(" \xB7 ") || void 0,
    forms: forms.slice(0, 8)
  };
}
class OpenWordsEngine {
  constructor(words, stems, inflections, uniques, customWords, addons) {
    this.inflections = inflections;
    this.addons = addons;
    this.wordsById = /* @__PURE__ */ new Map();
    this.stemsByOrth = /* @__PURE__ */ new Map();
    this.exactByOrth = /* @__PURE__ */ new Map();
    for (const word of words) {
      if (word.id != null) this.wordsById.set(word.id, word);
    }
    for (const stem of stems) {
      const key = normalize(stem.orth);
      const collection = this.stemsByOrth.get(key) ?? [];
      collection.push(stem);
      this.stemsByOrth.set(key, collection);
    }
    for (const word of [...uniques, ...customWords]) {
      const key = normalize(word.orth);
      this.exactByOrth.set(key, [...this.exactByOrth.get(key) ?? [], word]);
    }
    this.inflections.sort((a, b) => b.ending.length - a.ending.length);
  }
  lookup(rawToken) {
    const token = normalize(rawToken);
    if (!token) return [];
    const exact = this.exactByOrth.get(token);
    if (exact?.length) return exact.map((word) => toEntry(word, [formatForm(word.form, word.pos)]));
    let lookupToken = token;
    let suffixNote = "";
    for (const addon of this.addons.tackons ?? []) {
      const suffix = normalize(addon.orth);
      if (lookupToken.length > suffix.length + 1 && lookupToken.endsWith(suffix)) {
        const possibleBase = lookupToken.slice(0, -suffix.length);
        if (this.hasPossibleStem(possibleBase)) {
          lookupToken = possibleBase;
          suffixNote = addon.senses[0]?.replace(/;.*/, "") ?? `with -${addon.orth}`;
          break;
        }
      }
    }
    const candidates = /* @__PURE__ */ new Map();
    for (const inflection of this.inflections) {
      const ending = normalize(inflection.ending);
      if (!lookupToken.endsWith(ending)) continue;
      const stemText = ending ? lookupToken.slice(0, -ending.length) : lookupToken;
      const possibleStems = this.stemsByOrth.get(stemText) ?? [];
      for (const stem of possibleStems) {
        if (!sameInflectionFamily(stem, inflection)) continue;
        const word = this.wordsById.get(stem.wid);
        if (!word || !genderMatches(word, inflection)) continue;
        const current = candidates.get(stem.wid) ?? { word, forms: /* @__PURE__ */ new Set(), score: 0 };
        current.forms.add(formatForm(inflection.form, inflection.pos));
        const exactVariant = stem.n?.[1] === inflection.n?.[1] && inflection.n?.[1] !== 0;
        const firstPersonVerb = word.pos === "V" && /IND\s+1\s+S/.test(inflection.form);
        const directPartMatch = stem.pos === inflection.pos;
        current.score = Math.max(
          current.score,
          ending.length * 5 + (directPartMatch ? 4 : 0) + (exactVariant ? 3 : 0) + (firstPersonVerb ? 2 : 0)
        );
        candidates.set(stem.wid, current);
      }
    }
    const deduped = /* @__PURE__ */ new Map();
    for (const candidate of candidates.values()) {
      const entry = toEntry(candidate.word, [...candidate.forms], suffixNote);
      const key = `${entry.lemma}|${entry.meaning}`;
      const existing = deduped.get(key);
      if (existing) {
        existing.forms = [.../* @__PURE__ */ new Set([...existing.forms, ...entry.forms])].slice(0, 8);
        existing.score = Math.max(existing.score, candidate.score);
      } else {
        deduped.set(key, { ...entry, score: candidate.score });
      }
    }
    return [...deduped.values()].sort((a, b) => b.score - a.score || a.lemma.localeCompare(b.lemma)).slice(0, 6).map(({ score: _score, ...entry }) => entry);
  }
  hasPossibleStem(token) {
    if (this.exactByOrth.has(token) || this.stemsByOrth.has(token)) return true;
    return this.inflections.some((inflection) => {
      const ending = normalize(inflection.ending);
      return token.endsWith(ending) && this.stemsByOrth.has(ending ? token.slice(0, -ending.length) : token);
    });
  }
}
let enginePromise = null;
async function fetchData(name) {
  const response = await fetch(`${DATA_ROOT}/${name}.json`);
  if (!response.ok) throw new Error(`Could not load ${name}`);
  return response.json();
}
function getEngine() {
  if (!enginePromise) {
    enginePromise = Promise.all([
      fetchData("words"),
      fetchData("stems"),
      fetchData("inflects"),
      fetchData("uniques"),
      fetchData("custom-words"),
      fetchData("addons")
    ]).then(
      ([words, stems, inflections, uniques, customWords, addons]) => new OpenWordsEngine(words, stems, inflections, uniques, customWords, addons)
    );
  }
  return enginePromise;
}
async function lookupLatinWord(token) {
  return (await getEngine()).lookup(token);
}
export {
  lookupLatinWord
};
