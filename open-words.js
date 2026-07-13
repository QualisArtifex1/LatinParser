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
  // First-family pronouns use variant zero for their shared paradigm. Its
  // generic endings must not admit specialized quis/aliquis variants; those
  // variants have their own explicit endings. Other parts of speech (and the
  // other pronoun families) use zero as the legacy wildcard.
  const strictFirstPronounVariant = stem.pos === "PRON" && stemClass === 1 && endingVariant === 0;
  const variantMatches = stemVariant == null || endingVariant == null || stemVariant === endingVariant || stemVariant === 0 ||
    (!strictFirstPronounVariant && endingVariant === 0);
  return classMatches && variantMatches;
}
function stemPositions(word, stem) {
  if (!word.parts) return [];
  const stemText = normalize(stem.orth);
  return word.parts.reduce((positions, part, index) => {
    if (normalize(part) === stemText) positions.push(index);
    return positions;
  }, []);
}
function isPerfectSystem(form) {
  return form.startsWith("PERF") || form.startsWith("PLUP") || form.startsWith("FUTP");
}
function isDeponent(word) {
  return word.form.trim().split(/\s+/)[2] === "DEP";
}
function isSemiDeponent(word) {
  return word.form.trim().split(/\s+/)[2] === "SEMIDEP";
}
function isImpersonal(word) {
  return word.form.trim().split(/\s+/)[2] === "IMPERS";
}
function isFiniteForm(form) {
  return /\s(?:IND|SUB|IMP)\s/.test(form);
}
function isPresentStemParticiple(form) {
  return form.includes("PRES ACTIVE") || form.includes("FUT  PASSIVE");
}
function specialVerbStemMatches(word, stem, inflection, positions) {
  const isEoFamily = word.n?.[0] === 6 && word.n?.[1] === 1;
  const isSpecialPresent = inflection.note === "eo_ire" && positions.includes(0) && normalize(stem.orth) === "e" && inflection.form.startsWith("PRES  ACTIVE  IND");
  if (!isEoFamily || !isSpecialPresent) return true;
  return ["PRES  ACTIVE  IND  1 S", "PRES  ACTIVE  IND  3 P"].includes(inflection.form);
}
function verbStemMatches(word, stem, inflection) {
  if (stem.pos !== "V" || !word.parts) return true;
  const positions = stemPositions(word, stem);
  if (inflection.pos === "VPAR") {
    return isPresentStemParticiple(inflection.form) ? positions.includes(0) : positions.includes(3);
  }
  if (inflection.pos !== "V") return true;
  if (isDeponent(word) && inflection.form.includes("ACTIVE")) return false;
  if (isSemiDeponent(word)) {
    if (!isPerfectSystem(inflection.form) && inflection.form.includes("PASSIVE")) return false;
    // Completed-action forms are periphrastic (for example, ausus sum), not
    // perfect-stem forms with ordinary active endings. Defective exceptions
    // such as ausim have their own dictionary record and inflection family.
    if (isPerfectSystem(inflection.form)) return false;
  }
  if (isImpersonal(word) && isFiniteForm(inflection.form) && !/\s3 S$/.test(inflection.form)) return false;
  const bareThirdConjugationImperative = inflection.ending === "" &&
    (sameNumberPair(inflection.n, [3, 1]) || sameNumberPair(inflection.n, [3, 2]));
  if (bareThirdConjugationImperative && inflection.form.replace(/\s+/g, " ").trim() === "PRES ACTIVE IMP 2 S" &&
    !/(?:dic|duc|fac|fer)$/.test(normalize(stem.orth))) return false;
  if (!specialVerbStemMatches(word, stem, inflection, positions)) return false;
  if (isPerfectSystem(inflection.form)) return positions.includes(2);
  if (positions.includes(3)) return false;
  const genericVariant = inflection.n?.[1] === 0;
  if (genericVariant) return positions.includes(0);
  return positions.includes(0) || positions.includes(1);
}
function pronounStemMatches(word, stem, inflection) {
  if (stem.pos !== "PRON" || word.pos !== "PRON" || !word.parts) return true;
  const positions = stemPositions(word, stem);
  const [declension, variant] = word.n ?? [];
  const form = inflection.form.replace(/\s+/g, " ").trim();
  if (declension === 1 || declension === 3) {
    const usesObliqueStem = form.startsWith("GEN S ") || form.startsWith("DAT S ");
    return usesObliqueStem ? positions.includes(1) : positions.includes(0);
  }
  if (declension === 4) {
    const ending = normalize(inflection.ending);
    const sharedStemForm = form === "NOM P M" && ending === "i" ||
      (form === "DAT P X" || form === "ABL P X") && ending === "is";
    if (sharedStemForm) return positions.includes(0) || positions.includes(1);
    const firstStemForm = form === "NOM S M";
    return firstStemForm ? positions.includes(0) : positions.includes(1);
  }
  if (declension === 5) {
    if (variant === 1) {
      if (form.startsWith("DAT S ") && normalize(inflection.ending) === "i") return false;
      return form.startsWith("NOM S ") ? positions.includes(0) : positions.includes(1);
    }
    if (variant === 2) return /^(NOM|VOC) S /.test(form) ? positions.includes(0) : positions.includes(1);
    if (variant === 3) return form.startsWith("GEN P ") ? positions.includes(1) : positions.includes(0);
    if (variant === 4) return positions.includes(1);
  }
  return true;
}
function nounStemMatches(word, stem, inflection) {
  if (stem.pos !== "N" || word.pos !== "N" || !word.parts || ![2, 3].includes(word.n?.[0])) return true;
  const positions = stemPositions(word, stem);
  if (positions.length !== 1) return true;
  const form = inflection.form.replace(/\s+/g, " ").trim();
  const nominativeStemForm = form.startsWith("NOM S ") || form.startsWith("VOC S ");
  return nominativeStemForm ? positions.includes(0) : positions.includes(1);
}
function genderMatches(word, inflection) {
  if (word.pos !== "N" || inflection.pos !== "N") return true;
  const wordGender = word.form.trim().split(/\s+/)[2];
  const endingGender = inflection.form.trim().split(/\s+/)[2];
  if (!endingGender || endingGender === "X") return true;
  if (endingGender === "C") return wordGender !== "N";
  return wordGender === endingGender;
}
function adjectiveDegreeMatches(word, inflection) {
  if (word.pos !== "ADJ" || inflection.pos !== "ADJ") return true;
  const degree = word.form.trim().split(/\s+/)[2];
  const comparisonFamily = inflection.n?.[0] === 0 && /^3\s/.test(inflection.ending);
  const superlativeFamily = inflection.n?.[0] === 0 && /^4\s/.test(inflection.ending);
  if (degree === "COMP") return comparisonFamily;
  if (degree === "SUPER") return superlativeFamily;
  return !comparisonFamily && !superlativeFamily;
}
function formatForm(form, pos) {
  const words = form.trim().split(/\s+/).filter(Boolean);
  const personIndex = pos === "V" ? words.findIndex((word) => /^[123]$/.test(word)) : -1;
  return words.map((word, index) => {
    if (index === personIndex) return `${word}${word === "1" ? "st" : word === "2" ? "nd" : "rd"} person`;
    return FORM_WORDS[word] ?? word.toLocaleLowerCase();
  }).filter((word) => word !== "x" && (pos === "V" || !/^\d+$/.test(word))).join(" \xB7 ");
}
function formatInflectionForm(inflection, word) {
  if (word.pos !== "N" || inflection.pos !== "N") return formatForm(inflection.form, inflection.pos);
  const tokens = inflection.form.trim().split(/\s+/);
  const wordGender = word.form.trim().split(/\s+/)[2];
  if (tokens[2] === "X" || tokens[2] === "C") tokens[2] = wordGender;
  return formatForm(tokens.join(" "), inflection.pos);
}
function genderName(word) {
  if (word.pos !== "N") return "";
  const gender = word.form.trim().split(/\s+/)[2];
  return { M: "masculine", F: "feminine", N: "neuter", C: "common gender" }[gender] ?? "";
}
function sameNumberPair(left, right) {
  return left?.length === right?.length && left.every((value, index) => value === right[index]);
}
function inflectionEnding(inflections, word, pos, form) {
  const target = form.replace(/\s+/g, " ").trim();
  return inflections.filter((inflection) => {
    const genericParticiple = pos === "VPAR" && sameNumberPair(inflection.n, [0, 0]);
    return inflection.pos === pos &&
      (sameNumberPair(inflection.n, word.n) || genericParticiple) &&
      inflection.form.replace(/\s+/g, " ").trim() === target;
  }).sort((left, right) => left.ending.length - right.ending.length)[0]?.ending;
}
function appendEnding(stem, ending, fallback) {
  if (!stem) return "";
  return `${stem}${ending ?? fallback}`;
}
function formatPronounLemma(word) {
  if (word.id == null) return word.lemma ?? word.orth;
  const [first = word.orth, second = first] = (word.parts ?? [word.orth]).map((part) => part.trim());
  const [declension, variant] = word.n ?? [];
  const kind = word.pronounType ?? word.form.trim().split(/\s+/).at(-1);
  if (declension === 1) {
    if (normalize(first) === "aliqu") {
      return kind === "ADJECT" ? "aliqui, aliqua, aliquod" : "aliquis, aliquid";
    }
    if (normalize(first) === "qu") {
      return kind === "REL" || kind === "ADJECT" ? "qui, quae, quod" : "quis, quid";
    }
  }
  if (declension === 3) {
    const neuter = normalize(first) === "h" ? `${first}oc` : `${second}c`;
    return `${first}ic, ${first}aec, ${neuter}`;
  }
  if (declension === 4) {
    if (variant === 1) return `${first}s, ${second}a, ${first}d`;
    if (variant === 2) return `${first}dem, ${second}adem, ${first}dem`;
  }
  if (declension === 5) {
    if (variant === 1) return "ego";
    if (variant === 2) return "tu";
    if (variant === 3) return normalize(first) === "n" ? "nos" : "vos";
    if (variant === 4) return "sui";
  }
  if (declension === 6) return `${first}e, ${first}a, ${first}${variant === 2 ? "um" : "ud"}`;
  return "";
}
function formatLemma(word, inflections) {
  const rawParts = (word.parts ?? [word.orth]).map((part) => part.trim());
  const parts = rawParts.filter(Boolean);
  if (word.pos === "PRON") return formatPronounLemma(word) || parts.join(", ") || word.orth;
  if (word.id == null && word.lemma) return word.lemma;
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
    const [present = word.orth, infinitive = present, perfect = "", participle = ""] = rawParts;
    const flag = word.form.trim().split(/\s+/)[2] ?? "";
    const deponent = flag === "DEP";
    const semiDeponent = flag === "SEMIDEP";
    const impersonal = flag === "IMPERS";
    if (flag === "TO_BE") return "sum, esse, fui, futurus";
    if (flag === "TO_BEING") return "possum, posse, potui";
    const presentForm = impersonal ? "PRES ACTIVE IND 3 S" : deponent ? "PRES PASSIVE IND 1 S" : "PRES ACTIVE IND 1 S";
    const infinitiveForm = deponent ? "PRES PASSIVE INF 0 X" : "PRES ACTIVE INF 0 X";
    const defectiveConjugation = word.n?.[0] === 8 ? word.n?.[1] : 0;
    const presentFallback = impersonal ? "t" : deponent ? "or" : defectiveConjugation === 2 ? "eo" : "o";
    const infinitiveFallback = deponent ? "i" : defectiveConjugation === 1 ? "are" : "ere";
    const presentPart = appendEnding(present, inflectionEnding(inflections, word, "V", presentForm), presentFallback);
    const infinitivePart = appendEnding(infinitive, inflectionEnding(inflections, word, "V", infinitiveForm), infinitiveFallback);
    const perfectPart = appendEnding(perfect, inflectionEnding(inflections, word, "V", "PERF ACTIVE IND 1 S"), "i");
    const participleStem = participle || (semiDeponent ? perfect : "");
    const participlePart = appendEnding(participleStem, inflectionEnding(inflections, word, "VPAR", "NOM S M PERF PASSIVE PPL"), "us");
    if (deponent || semiDeponent) {
      return [presentPart, infinitivePart, participlePart ? `${participlePart} sum` : ""].filter(Boolean).join(", ");
    }
    if (impersonal) {
      return [presentPart, infinitivePart, perfectPart, participlePart ? `${participlePart} est` : ""].filter(Boolean).join(", ");
    }
    return [
      presentPart,
      infinitivePart,
      perfectPart,
      participlePart
    ].filter(Boolean).join(", ");
  }
  if (word.pos === "ADJ" && declension === 1) {
    const first = parts[0] ?? word.orth;
    return `${first}us, ${first}a, ${first}um`;
  }
  if (word.pos === "ADJ" && declension === 3) {
    const [nominative = word.orth, oblique = "", comparative = "", superlative = ""] = rawParts;
    const positive = word.n?.[1] === 2 ? `${nominative}is, ${oblique || nominative}e` : nominative;
    return [
      positive,
      word.n?.[1] === 1 && oblique ? `${oblique}is` : "",
      comparative ? `${comparative}or` : "",
      superlative ? `${superlative}mus` : ""
    ].filter(Boolean).join(", ");
  }
  return parts.join(", ") || word.orth;
}
function metadataForWord(word, entryMetadata) {
  if (word.id == null) return undefined;
  const code = entryMetadata.codes[word.id - 1];
  if (!code) return undefined;
  return {
    code,
    ...Object.fromEntries(entryMetadata.fields.map((field, index) => [field, code[index]]))
  };
}
function toEntry(word, forms, suffixNote, inflections, entryMetadata) {
  const gender = genderName(word);
  const participleOnly = forms.length > 0 && forms.every((form) => form.includes("participle"));
  const entryPart = participleOnly ? "VPAR" : word.pos;
  const part = [PARTS[entryPart] ?? entryPart.toLocaleLowerCase(), gender].filter(Boolean).join(" \xB7 ");
  const deponent = isDeponent(word);
  const displayedForms = deponent ? forms.map((form) => form.replace("passive \xB7 ", "")) : forms;
  const senses = word.senses.map((sense) => sense.replace(/^\|/, "").trim()).filter(Boolean);
  return {
    id: `${word.id ?? word.orth}-${word.pos}-${word.form}`,
    lemma: formatLemma(word, inflections),
    part,
    meaning: senses[0] ?? "Definition unavailable",
    senses,
    note: suffixNote || undefined,
    metadata: metadataForWord(word, entryMetadata),
    forms: [...new Set(displayedForms)]
  };
}
function entryKey(entry) {
  return [entry.lemma, entry.part, JSON.stringify(entry.senses)].join("|");
}
function normalizeExactWord(word) {
  const pronoun = word.pos === "P" && word.form?.startsWith("RON ");
  const adjective = word.pos === "A" && word.form?.startsWith("DJ");
  if (!pronoun && !adjective) {
    if (word.pos === "V" && normalize(word.orth) === "sum") return { ...word, lemma: "sum, esse, fui, futurus" };
    return word;
  }
  const tokens = word.form.trim().split(/\s+/);
  const declension = Number(tokens[1]);
  const variant = Number(tokens[2]);
  return {
    ...word,
    pos: pronoun ? "PRON" : "ADJ",
    n: [declension, variant],
    form: tokens.slice(3, -1).join(" "),
    ...(pronoun ? { pronounType: tokens.at(-1) } : {}),
    lemma: pronoun && declension === 4 && variant === 2 ? "idem, eadem, idem" : word.orth
  };
}
// Readable browser port of the legacy Open Words Parse pipeline. The lookup
// remains stem/inflection driven, while the compatibility predicates above
// carry the correctness fixes discovered after the original app was built.
class OpenWordsParser {
  constructor(words, stems, inflections, uniques, customWords, addons, entryMetadata = { fields: [], codes: [] }) {
    this.inflections = [...inflections];
    this.addons = addons;
    this.entryMetadata = entryMetadata;
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
    for (const sourceWord of [...uniques, ...customWords]) {
      const word = normalizeExactWord(sourceWord);
      const key = normalize(word.orth);
      this.exactByOrth.set(key, [...this.exactByOrth.get(key) ?? [], word]);
    }
    for (const word of words.filter((word) => !word.form?.trim() && word.orth)) {
      const key = normalize(word.orth);
      this.exactByOrth.set(key, [...this.exactByOrth.get(key) ?? [], word]);
    }
    this.inflections.sort((a, b) => b.ending.length - a.ending.length);
  }
  parseLine(line) {
    return (line.match(/[A-Za-z\u00C0-\u0233]+/g) ?? []).map((word) => ({ word, defs: this.parse(word) }));
  }
  parse(rawToken) {
    return this.lookupBaseWord(rawToken);
  }
  lookup(rawToken) {
    return this.lookupBaseWord(rawToken);
  }
  lookupBaseWord(rawToken) {
    const token = normalize(rawToken);
    if (!token) return [];
    const exact = this.exactByOrth.get(token);
    const exactEntries = (exact ?? []).map((word) =>
      toEntry(word, [word.form.trim() ? formatForm(word.form, word.pos) : "indeclinable"], "", this.inflections, this.entryMetadata)
    );
    let lookupToken = token;
    let suffixNote = "";
    let idemTackon = false;
    const dem = this.addons.not_packons?.find((addon) => normalize(addon.orth) === "dem");
    if (dem && lookupToken.length > 3 && lookupToken.endsWith("dem")) {
      const possibleBase = lookupToken.slice(0, -3);
      if (this.hasPossibleStem(possibleBase)) {
        lookupToken = possibleBase;
        idemTackon = true;
      }
    }
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
    const exactPronounFamilies = new Set((exact ?? []).filter((word) => word.pos === "PRON").map((word) => word.n?.join(".")));
    for (const inflection of this.inflections) {
      const ending = normalize(inflection.ending);
      if (!lookupToken.endsWith(ending)) continue;
      const stemText = ending ? lookupToken.slice(0, -ending.length) : lookupToken;
      const possibleStems = this.stemsByOrth.get(stemText) ?? [];
      for (const stem of possibleStems) {
        if (!sameInflectionFamily(stem, inflection)) continue;
        const word = this.wordsById.get(stem.wid);
        if (!word || !genderMatches(word, inflection) || !adjectiveDegreeMatches(word, inflection) ||
          !verbStemMatches(word, stem, inflection) || !pronounStemMatches(word, stem, inflection) ||
          !nounStemMatches(word, stem, inflection)) continue;
        const isIdemEntry = word.pos === "PRON" && sameNumberPair(word.n, [4, 2]);
        if (isIdemEntry !== idemTackon) continue;
        if (word.pos === "PRON" && exactPronounFamilies.has(word.n?.join("."))) continue;
        const current = candidates.get(stem.wid) ?? { word, forms: /* @__PURE__ */ new Set(), score: 0 };
        current.forms.add(formatInflectionForm(inflection, word));
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
    for (const entry of exactEntries) {
      const key = entryKey(entry);
      const existing = deduped.get(key);
      if (existing) {
        existing.forms = [.../* @__PURE__ */ new Set([...existing.forms, ...entry.forms])];
      } else {
        deduped.set(key, { ...entry, score: Number.POSITIVE_INFINITY });
      }
    }
    for (const candidate of candidates.values()) {
      const entry = toEntry(candidate.word, [...candidate.forms], suffixNote, this.inflections, this.entryMetadata);
      const key = entryKey(entry);
      const existing = deduped.get(key);
      if (existing) {
        existing.forms = [.../* @__PURE__ */ new Set([...existing.forms, ...entry.forms])];
        existing.score = Math.max(existing.score, candidate.score);
      } else {
        deduped.set(key, { ...entry, score: candidate.score });
      }
    }
    return [...deduped.values()].sort((a, b) => b.score - a.score || a.lemma.localeCompare(b.lemma)).map(({ score: _score, ...entry }) => entry);
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
      fetchData("word-corrections"),
      fetchData("stems"),
      fetchData("inflects"),
      fetchData("uniques"),
      fetchData("custom-words"),
      fetchData("addons"),
      fetchData("entry-metadata")
    ]).then(
      ([words, wordCorrections, stems, inflections, uniques, customWords, addons, entryMetadata]) =>
        new OpenWordsParser([...words, ...wordCorrections], stems, inflections, uniques, customWords, addons, entryMetadata)
    );
  }
  return enginePromise;
}
async function lookupLatinWord(token) {
  return (await getEngine()).lookup(token);
}
export {
  OpenWordsParser,
  lookupLatinWord
};
