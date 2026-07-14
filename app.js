import { lookupLatinWord } from "./open-words.js";

const SAMPLE = "Gallia est omnis divisa in partes tres.";
const STORAGE_KEY = "latin-dictionary-study-list";

const passage = document.querySelector("#latin-passage");
const form = document.querySelector("#lookup-form");
const analyzeButton = document.querySelector("#analyze-button");
const analyzeLabel = document.querySelector(".analyze-label");
const sampleButtons = [document.querySelector("#sample-button"), document.querySelector("#welcome-sample-button")];
const welcomeCard = document.querySelector("#welcome-card");
const resultsArea = document.querySelector("#results-area");
const tokenRibbon = document.querySelector("#token-ribbon");
const definitionList = document.querySelector("#definition-list");
const wordCount = document.querySelector("#word-count");
const lookupError = document.querySelector("#lookup-error");
const drawer = document.querySelector("#study-drawer");
const backdrop = document.querySelector("#drawer-backdrop");
const savedList = document.querySelector("#saved-list");
const savedCount = document.querySelector("#saved-count");
const copyButton = document.querySelector("#copy-list");
const downloadButton = document.querySelector("#download-list");

let analyzedTokens = [];
let selectedIndex = 0;
let savedEntries = loadSavedEntries();

function loadSavedEntries() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function persistSavedEntries() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(savedEntries));
  renderStudyList();
}

function entryIsSaved(entry) {
  return savedEntries.some((item) => item.id === entry.id ||
    (!item.id && item.lemma === entry.lemma && item.meaning === entry.meaning));
}

function toggleSavedEntry(entry) {
  if (entryIsSaved(entry)) {
    savedEntries = savedEntries.filter((item) => item.id !== entry.id &&
      !(!item.id && item.lemma === entry.lemma && item.meaning === entry.meaning));
  } else {
    savedEntries.push({
      id: entry.id,
      lemma: entry.lemma,
      part: entry.part,
      meaning: entry.meaning,
      senses: entry.senses,
      sourceIds: entry.sourceIds,
      metadata: entry.metadata,
      metadataVariants: entry.metadataVariants
    });
  }
  persistSavedEntries();
  renderDefinitions();
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function setAnalyzing(active) {
  analyzeButton.disabled = active || !passage.value.trim();
  analyzeLabel.textContent = active ? "Analyzing passage…" : "Analyze passage";
  sampleButtons.forEach((button) => { button.disabled = active; });
}

async function runAnalysis(text) {
  const words = text.match(/[A-Za-zÀ-ȳ]+/g) || [];
  if (!words.length) return;
  setAnalyzing(true);
  lookupError.hidden = true;
  try {
    analyzedTokens = await Promise.all(words.map(async (word) => ({ text: word, entries: await lookupLatinWord(word) })));
    selectedIndex = 0;
    welcomeCard.hidden = true;
    resultsArea.hidden = false;
    renderResults();
  } catch {
    lookupError.textContent = "The dictionary data could not be loaded. Please check your connection and try again.";
    lookupError.hidden = false;
  } finally {
    setAnalyzing(false);
  }
}

function renderResults() {
  wordCount.textContent = `${analyzedTokens.length} words`;
  tokenRibbon.replaceChildren();
  analyzedTokens.forEach((token, index) => {
    const button = makeElement("button", index === selectedIndex ? "selected" : "");
    button.type = "button";
    button.setAttribute("aria-pressed", String(index === selectedIndex));
    button.append(makeElement("span", "", token.text));
    const count = token.entries.length;
    button.append(makeElement("small", "", count ? `${count} ${count === 1 ? "entry" : "entries"}` : "no entry"));
    button.addEventListener("click", () => {
      selectedIndex = index;
      renderResults();
    });
    tokenRibbon.append(button);
  });
  renderDefinitions();
}

function renderDefinitions() {
  definitionList.replaceChildren();
  const token = analyzedTokens[selectedIndex];
  if (!token) return;

  if (!token.entries.length) {
    const card = makeElement("article", "definition-card");
    card.append(makeElement("div", "definition-index", String(selectedIndex + 1).padStart(2, "0")));
    const message = makeElement("div", "not-found");
    message.append(makeElement("span", "eyebrow", "No dictionary entry"));
    message.append(makeElement("h2", "", token.text));
    message.append(makeElement("p", "", "The dictionary did not find this form. Try checking the spelling or removing punctuation."));
    card.append(message);
    definitionList.append(card);
    return;
  }

  token.entries.forEach((entry, index) => {
    const card = makeElement("article", "definition-card");
    card.append(makeElement("div", "definition-index", String(index + 1).padStart(2, "0")));

    const main = makeElement("div", "definition-main");
    main.append(makeElement("span", "eyebrow", `Dictionary entry ${index + 1} of ${token.entries.length}`));
    main.append(makeElement("h2", "", entry.lemma));
    const classification = makeElement("div", "entry-classification");
    classification.append(makeElement("p", "part-of-speech", entry.part));
    main.append(classification);
    const senses = entry.senses?.length ? entry.senses : [entry.meaning];
    const senseList = makeElement("ol", "definition-senses");
    senses.forEach((sense) => senseList.append(makeElement("li", "", sense)));
    main.append(senseList);
    if (entry.note) main.append(makeElement("p", "lookup-note", entry.note));
    card.append(main);

    const grammar = makeElement("div", "grammar-panel");
    grammar.append(makeElement("span", "eyebrow", "Possible forms"));
    const chips = makeElement("div", "grammar-chips");
    entry.forms.forEach((item) => chips.append(makeElement("span", "", item)));
    grammar.append(chips);
    const saveButton = makeElement("button", entryIsSaved(entry) ? "save-button saved" : "save-button", entryIsSaved(entry) ? "Saved to study list ✓" : "+ Save to study list");
    saveButton.type = "button";
    saveButton.addEventListener("click", () => toggleSavedEntry(entry));
    grammar.append(saveButton);
    card.append(grammar);
    definitionList.append(card);
  });
}

function studyText() {
  return savedEntries.map((item) => {
    const definitions = item.senses?.length ? item.senses.join("; ") : item.meaning;
    return `${item.lemma}\t${item.part}\t${definitions}`;
  }).join("\n");
}

function renderStudyList() {
  savedCount.textContent = String(savedEntries.length);
  copyButton.disabled = !savedEntries.length;
  downloadButton.disabled = !savedEntries.length;
  savedList.replaceChildren();

  if (!savedEntries.length) {
    const empty = makeElement("div", "empty-study");
    empty.append(makeElement("span", "", "＋"));
    empty.append(makeElement("h3", "", "No saved entries yet"));
    empty.append(makeElement("p", "", "Choose “Save to study list” on any definition."));
    savedList.append(empty);
    return;
  }

  savedEntries.forEach((entry) => {
    const article = document.createElement("article");
    const copy = document.createElement("div");
    copy.append(makeElement("h3", "", entry.lemma));
    copy.append(makeElement("small", "", entry.part));
    copy.append(makeElement("p", "", entry.senses?.length ? entry.senses.join("; ") : entry.meaning));
    article.append(copy);
    const remove = makeElement("button", "", "Remove");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${entry.lemma}`);
    remove.addEventListener("click", () => {
      savedEntries = savedEntries.filter((item) => item.id !== entry.id &&
        !(!item.id && item.lemma === entry.lemma && item.meaning === entry.meaning));
      persistSavedEntries();
      renderDefinitions();
    });
    article.append(remove);
    savedList.append(article);
  });
}

function openDrawer() {
  drawer.classList.add("open");
  backdrop.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  drawer.classList.remove("open");
  backdrop.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  runAnalysis(passage.value);
});

passage.addEventListener("input", () => { analyzeButton.disabled = !passage.value.trim(); });
passage.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    runAnalysis(passage.value);
  }
});

tokenRibbon.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key) || !analyzedTokens.length) return;
  event.preventDefault();
  selectedIndex = (selectedIndex + (event.key === "ArrowRight" ? 1 : -1) + analyzedTokens.length) % analyzedTokens.length;
  renderResults();
  tokenRibbon.children[selectedIndex]?.focus();
});

sampleButtons.forEach((button) => button.addEventListener("click", () => {
  passage.value = SAMPLE;
  runAnalysis(SAMPLE);
}));

document.querySelector("#open-study-list").addEventListener("click", openDrawer);
document.querySelector("#close-study-list").addEventListener("click", closeDrawer);
backdrop.addEventListener("click", closeDrawer);
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDrawer(); });

copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(studyText());
  copyButton.textContent = "Copied ✓";
  window.setTimeout(() => { copyButton.textContent = "Copy list"; }, 1600);
});

downloadButton.addEventListener("click", () => {
  const blob = new Blob([`${studyText()}\n`], { type: "text/tab-separated-values;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = "latin-study-list.tsv";
  anchor.click();
  URL.revokeObjectURL(href);
});

renderStudyList();

const initialQuery = new URLSearchParams(window.location.search).get("q")?.trim();
if (initialQuery) {
  passage.value = initialQuery;
  runAnalysis(initialQuery);
}
