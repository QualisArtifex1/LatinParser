import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

globalThis.fetch = async (url) => {
  const path = String(url).replace("./open-words/", "open-words/");
  try {
    return { ok: true, json: async () => JSON.parse(await fs.readFile(path, "utf8")) };
  } catch {
    return { ok: false };
  }
};

const { OpenWordsParser, lookupLatinWord } = await import(pathToFileURL(`${process.cwd()}/open-words.js`));
const lookup = (word) => lookupLatinWord(word);
const hasMeaning = (entries, text) => entries.some((entry) => entry.meaning.includes(text));

test("venit keeps only its genuine unmacronized ambiguities", async () => {
  const entries = await lookup("venit");
  assert.deepEqual(entries.map((entry) => entry.lemma), [
    "venio, venire, veni, ventus",
    "veneo, venire, venivi, venitus"
  ]);
  assert.equal(hasMeaning(entries, "hunt"), false);
  assert.deepEqual(entries[0].forms.sort(), [
    "perfect · active · indicative · 3rd person · singular",
    "present · active · indicative · 3rd person · singular"
  ]);
  assert.deepEqual(entries[1].forms, ["present · active · indicative · 3rd person · singular"]);
});

test("present and gerundive participles use the present stem", async () => {
  const amans = await lookup("amans");
  assert.equal(amans.length, 3);
  assert.equal(amans[0].lemma, "amo, amare, amavi, amatus");
  assert.equal(amans[0].part, "participle");
  assert.equal(amans[1].lemma, "amans, amantis, amantior, amantissimus");
  assert.equal(amans[2].lemma, "amans, amantis");

  const amandus = await lookup("amandus");
  assert.equal(amandus[0].lemma, "amo, amare, amavi, amatus");
  assert.equal(amandus[0].part, "participle");
  assert.equal((await lookup("amatans")).length, 0);
  assert.equal((await lookup("amatandus")).length, 0);
});

test("perfect and future active participles continue to use the supine stem", async () => {
  const amatus = await lookup("amatus");
  const amaturus = await lookup("amaturus");
  assert.ok(amatus.some((entry) => entry.lemma === "amo, amare, amavi, amatus" && entry.part === "participle"));
  assert.ok(amaturus.some((entry) => entry.lemma === "amo, amare, amavi, amatus" && entry.part === "participle"));
});

test("semideponents reject regular passive-present and active-perfect forms", async () => {
  assert.ok((await lookup("audes")).some((entry) => entry.lemma === "audeo, audere, ausus sum"));
  assert.equal((await lookup("auderis")).some((entry) => entry.meaning.includes("intend")), false);
  const ausi = await lookup("ausi");
  const audeo = ausi.find((entry) => entry.lemma === "audeo, audere, ausus sum");
  assert.ok(audeo);
  assert.equal(audeo.forms.some((form) => form.startsWith("perfect · active")), false);
  assert.equal((await lookup("ausim")).some((entry) => entry.forms.some((form) => form.startsWith("perfect · active"))), false);
});

test("impersonal entries are finite only in the third-person singular", async () => {
  const licet = await lookup("licet");
  assert.ok(licet.some((entry) => entry.lemma === "licet, licere, licui, licitus est"));
  const lices = await lookup("lices");
  assert.equal(hasMeaning(lices, "permitted"), false);
  assert.ok(hasMeaning(lices, "fetch"));
  assert.equal(hasMeaning(await lookup("pudeo"), "it shames"), false);
});

test("deponent principal parts and morphology are presented as deponent", async () => {
  const entry = (await lookup("loquitur"))[0];
  assert.equal(entry.lemma, "loquor, loqui, locutus sum");
  assert.deepEqual(entry.forms, ["present · indicative · 3rd person · singular"]);
});

test("partes remains nominal, not verbal", async () => {
  assert.ok((await lookup("partes")).every((entry) => !["verb", "participle"].includes(entry.part)));
});

test("is and idem display their complete irregular pronoun headwords", async () => {
  const isEntries = await lookup("is");
  const isPronoun = isEntries.find((entry) => entry.part === "pronoun");
  assert.ok(isPronoun);
  assert.deepEqual(isEntries.map((entry) => entry.part).sort(), ["pronoun", "verb"]);
  assert.equal(isPronoun.lemma, "is, ea, id");
  assert.equal(isPronoun.meaning, "he/she/it/they (by GENDER/NUMBER)");
  assert.deepEqual(isPronoun.forms, ["nominative · singular · masculine"]);
  assert.equal(isEntries.some((entry) => entry.meaning.includes("the very same")), false);

  const idemEntries = await lookup("idem");
  assert.equal(idemEntries.length, 1);
  assert.equal(idemEntries[0].lemma, "idem, eadem, idem");
  assert.ok(idemEntries[0].meaning.includes("same"));
});

test("pronoun families display citation forms instead of internal stems", async () => {
  const cases = [
    ["qui", "qui, quae, quod"],
    ["quis", "quis, quid"],
    ["aliquis", "aliquis, aliquid"],
    ["hic", "hic, haec, hoc"],
    ["ille", "ille, illa, illud"],
    ["ipse", "ipse, ipsa, ipsum"],
    ["iste", "iste, ista, istud"],
    ["ego", "ego"],
    ["tu", "tu"],
    ["nos", "nos"],
    ["vos", "vos"],
    ["sui", "sui"]
  ];
  for (const [token, lemma] of cases) {
    const entries = await lookup(token);
    assert.ok(entries.some((entry) => entry.part === "pronoun" && entry.lemma === lemma), `${token} should display ${lemma}`);
  }
});

test("exact pronoun records are normalized and their forms are combined", async () => {
  const entries = await lookup("eadem");
  assert.equal(entries.length, 1);
  assert.ok(entries.every((entry) => entry.part === "pronoun"));
  assert.ok(entries.every((entry) => entry.lemma === "idem, eadem, idem"));
  const exact = entries.find((entry) => entry.meaning.startsWith("same"));
  assert.ok(exact);
  assert.deepEqual(exact.forms.sort(), [
    "accusative · plural · neuter",
    "nominative · plural · neuter",
    "nominative · singular · feminine"
  ]);
});

test("exact adjective records are normalized from the fixed-width import", async () => {
  const mi = await lookup("mi");
  const adjective = mi.find((entry) => entry.meaning.startsWith("my"));
  assert.ok(adjective);
  assert.equal(adjective.part, "adjective");
  assert.equal(adjective.lemma, "mi");
  assert.deepEqual(adjective.forms, ["vocative · singular · masculine"]);
});

test("pronoun stems are used only with their matching inflection families", async () => {
  const hic = (await lookup("hic")).find((entry) => entry.lemma === "hic, haec, hoc");
  const qui = (await lookup("qui")).find((entry) => entry.lemma === "qui, quae, quod");
  assert.deepEqual(hic.forms, ["nominative · singular · masculine"]);
  assert.equal(qui.forms.includes("dative · singular"), false);
});

test("noun forms use the dictionary entry's gender", async () => {
  const partes = await lookup("partes");
  assert.ok(partes.length > 0);
  assert.ok(partes.every((entry) => entry.forms.every((form) => form.endsWith("feminine"))));
  const amansNoun = (await lookup("amans")).find((entry) => entry.part === "noun · common gender");
  assert.ok(amansNoun.forms.every((form) => form.endsWith("common gender")));
});

test("short third-conjugation imperatives are limited to genuine irregulars", async () => {
  assert.equal((await lookup("leg")).some((entry) => entry.part === "verb"), false);
  assert.ok((await lookup("lege")).some((entry) => entry.lemma === "lego, legere, legi, lectus"));
  for (const token of ["dic", "duc", "fac", "fer"]) {
    assert.ok((await lookup(token)).some((entry) => entry.part === "verb" && entry.forms.includes("present · active · imperative · 2nd person · singular")));
  }
});

test("personal-pronoun alternatives do not acquire unrelated cases", async () => {
  const ego = (await lookup("mi")).find((entry) => entry.lemma === "ego");
  assert.ok(ego);
  assert.equal(ego.forms.includes("dative · singular · common gender"), false);
});

test("the missing sum record is restored without admitting sumo's imperative", async () => {
  const entries = await lookup("sum");
  assert.ok(entries.some((entry) => entry.lemma === "sum, esse, fui, futurus"));
  assert.equal(entries.some((entry) => entry.lemma.startsWith("sumo,")), false);
});

test("oblique noun stems do not masquerade as nominative forms", async () => {
  assert.equal((await lookup("leg")).some((entry) => entry.lemma === "lex, legis"), false);
  assert.ok((await lookup("lex")).some((entry) => entry.lemma === "lex, legis"));
  assert.ok((await lookup("legis")).some((entry) => entry.lemma === "lex, legis"));
});

test("possum uses its irregular principal parts", async () => {
  const entry = (await lookup("possum")).find((item) => item.meaning.startsWith("be able"));
  assert.ok(entry);
  assert.equal(entry.lemma, "possum, posse, potui");
  assert.deepEqual(entry.forms, ["present · active · indicative · 1st person · singular"]);
});

test("indeclinable conjunctions resolve as whole-word entries", async () => {
  const entry = (await lookup("ut")).find((item) => item.part === "conjunction");
  assert.ok(entry);
  assert.equal(entry.lemma, "ut");
  assert.equal(entry.meaning, "to (+ subjunctive), in order that/to");
  assert.deepEqual(entry.senses, [
    "to (+ subjunctive), in order that/to",
    "how, as, when, while",
    "even if"
  ]);
  assert.deepEqual(entry.metadata, {
    code: "XXXAX",
    age: "X",
    area: "X",
    geography: "X",
    frequency: "A",
    source: "X"
  });
  assert.deepEqual(entry.forms, ["indeclinable"]);
});

test("entries retain every dictionary sense", async () => {
  const entry = (await lookup("abax")).find((item) => item.id.startsWith("29-"));
  assert.ok(entry);
  assert.deepEqual(entry.senses, [
    "counting-board",
    "side-board",
    "slab table",
    "panel",
    "square stone on top of column"
  ]);
});

test("the legacy parser pipeline does not cap definitions or forms", () => {
  const words = Array.from({ length: 7 }, (_, index) => ({
    id: index + 1,
    orth: "x",
    parts: ["x"],
    pos: "CONJ",
    form: "",
    n: [0, 0],
    senses: [`sense ${index + 1}`]
  }));
  const exactForms = Array.from({ length: 9 }, (_, index) => ({
    orth: "y",
    pos: "ADV",
    form: `FORM${index + 1}`,
    senses: ["same sense"]
  }));
  const metadata = {
    fields: ["age", "area", "geography", "frequency", "source"],
    codes: words.map(() => "XXXXX")
  };
  const parser = new OpenWordsParser(words, [], [], exactForms, [], {}, metadata);
  assert.equal(parser.parse("x").length, 7);
  assert.equal(parser.parseLine("x")[0].defs.length, 7);
  assert.equal(parser.parse("y")[0].forms.length, 9);
});
