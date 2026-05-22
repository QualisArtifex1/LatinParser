import {
  BookMarked,
  Check,
  ChevronRight,
  Clipboard,
  Download,
  Loader2,
  Plus,
  Search,
  Trash2
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Definition, Inflection, ParseResponse, SavedTerm, TokenResult } from "./types";
import { parseLatinText } from "./lib/openWords";

const STORAGE_KEY = "latin-vocab.saved-terms";

const initialText = "";

function compactList(values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

function formatMorph(infl: Inflection) {
  const form = infl.form ?? {};
  if (typeof form.form === "string") {
    return form.form;
  }
  if (Array.isArray(form.form)) {
    return form.form.join(" ");
  }

  const chunks = [
    form.declension as string | undefined,
    form.tense as string | undefined,
    form.voice as string | undefined,
    form.mood as string | undefined,
    form.person ? `${form.person}p` : undefined,
    form.number as string | undefined,
    form.gender as string | undefined
  ];

  return compactList(chunks) || "unclassified";
}

function lemmaFor(definition: Definition) {
  return definition.orth.filter(Boolean).join(", ") || "unknown";
}

function firstSense(definition: Definition) {
  return definition.senses[0] ?? "No sense available";
}

function uniqueForms(definition: Definition) {
  const seen = new Set<string>();
  return definition.infls.filter((infl) => {
    const label = `${infl.pos}:${formatMorph(infl)}:${infl.ending}`;
    if (seen.has(label)) {
      return false;
    }
    seen.add(label);
    return true;
  });
}

function entryLabel(definition: Definition) {
  return [definition.entry?.pos, definition.entry?.gender].filter(Boolean).join(" ");
}

function loadSavedTerms(): SavedTerm[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as SavedTerm[];
  } catch {
    return [];
  }
}

function exportCell(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function exportDefinition(term: SavedTerm) {
  return exportCell(term.sense);
}

function canonicalSavedLemma(term: SavedTerm) {
  if (term.lemma === "itiner, itineris") {
    return "iter, itineris";
  }
  return term.lemma;
}

function genderAbbreviation(gender?: string) {
  const abbreviations: Record<string, string> = {
    masculine: "m",
    feminine: "f",
    neuter: "n",
    common: "c"
  };

  return gender ? abbreviations[gender.toLowerCase()] ?? "" : "";
}

function fallbackSavedGender(term: SavedTerm) {
  if (term.pos.toLowerCase() !== "noun") {
    return "";
  }

  const lemma = canonicalSavedLemma(term);
  if (lemma === "iter, itineris" || lemma.endsWith("um, i") || lemma.endsWith("um, armi")) {
    return "neuter";
  }
  if (/a,\s+\S+ae$/i.test(lemma)) {
    return "feminine";
  }
  if (/us,\s+\S+i$/i.test(lemma)) {
    return "masculine";
  }
  return "";
}

function exportHeadword(term: SavedTerm) {
  const gender = term.pos.toLowerCase() === "noun" ? genderAbbreviation(term.gender ?? fallbackSavedGender(term)) : "";
  return exportCell([canonicalSavedLemma(term), gender].filter(Boolean).join(" "));
}

function exportRows(terms: SavedTerm[]) {
  return terms.map((term) => `${exportHeadword(term)}\t${exportDefinition(term)}`).join("\n");
}

function copyWithTextarea(value: string) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  return copied;
}

function MorphPill({ infl }: { infl: Inflection }) {
  return (
    <span className="morph-pill">
      <span>{infl.pos}</span>
      {formatMorph(infl)}
      {infl.ending ? <em>-{infl.ending}</em> : null}
    </span>
  );
}

function DefinitionRow({
  definition,
  onSave,
  isSaved
}: {
  definition: Definition;
  onSave: () => void;
  isSaved: boolean;
}) {
  const forms = uniqueForms(definition).slice(0, 6);

  return (
    <article className="definition-row">
      <div>
        <div className="lemma">{lemmaFor(definition)}</div>
        {entryLabel(definition) ? <div className="entry-meta">{entryLabel(definition)}</div> : null}
        <div className="sense-list">
          {definition.senses.map((sense) => (
            <span key={sense}>{sense}</span>
          ))}
        </div>
        <div className="morph-list">
          {forms.map((infl) => (
            <MorphPill key={`${infl.pos}-${formatMorph(infl)}-${infl.ending}`} infl={infl} />
          ))}
        </div>
      </div>
      <button className="icon-button" type="button" onClick={onSave} aria-label="Save term">
        {isSaved ? <Check size={18} /> : <Plus size={18} />}
      </button>
    </article>
  );
}

function TokenButton({
  token,
  selected,
  onSelect
}: {
  token: TokenResult;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button className={`token-button ${selected ? "selected" : ""}`} type="button" onClick={onSelect}>
      <span>{token.word}</span>
      <small>{token.defs.length ? `${token.defs.length} matches` : "No match"}</small>
      <ChevronRight size={16} />
    </button>
  );
}

export default function App() {
  const [text, setText] = useState(initialText);
  const [result, setResult] = useState<ParseResponse | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [savedTerms, setSavedTerms] = useState<SavedTerm[]>(() => loadSavedTerms());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [exportStatus, setExportStatus] = useState("");

  const selectedToken = result?.tokens[selectedIndex] ?? null;

  const savedIds = useMemo(() => new Set(savedTerms.map((term) => term.id)), [savedTerms]);
  const exportText = useMemo(() => exportRows(savedTerms), [savedTerms]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedTerms));
  }, [savedTerms]);

  useEffect(() => {
    void handleParse(initialText);
  }, []);

  async function handleParse(nextText = text) {
    setLoading(true);
    setError("");
    try {
      const parsed = await parseLatinText(nextText);
      setResult(parsed);
      setSelectedIndex(0);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void handleParse();
  }

  function saveTerm(token: TokenResult, definition: Definition) {
    const firstInfl = definition.infls[0];
    const term: SavedTerm = {
      id: `${token.word}:${lemmaFor(definition)}:${firstSense(definition)}`,
      word: token.word,
      lemma: lemmaFor(definition),
      sense: firstSense(definition),
      pos: firstInfl?.pos ?? "word",
      gender: definition.entry?.pos === "noun" ? definition.entry.gender : undefined
    };

    setSavedTerms((terms) => {
      if (terms.some((item) => item.id === term.id)) {
        return terms;
      }
      return [term, ...terms].slice(0, 30);
    });
  }

  function removeTerm(id: string) {
    setSavedTerms((terms) => terms.filter((term) => term.id !== id));
  }

  async function copyStudyList() {
    if (!exportText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(exportText);
      setExportStatus("Copied");
    } catch {
      setExportStatus(copyWithTextarea(exportText) ? "Copied" : "Selected");
    }
  }

  function downloadStudyList() {
    if (!exportText) {
      return;
    }

    const blob = new Blob([`${exportText}\n`], { type: "text/tab-separated-values;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "latin-study-list.tsv";
    link.click();
    URL.revokeObjectURL(url);
    setExportStatus("Downloaded");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <BookMarked size={22} />
          </div>
          <div>
            <h1>Latin Vocab App</h1>
            <p>Open Words workspace</p>
          </div>
        </div>
        <div className="engine-status">
          <span className="status-dot" />
          browser parser
        </div>
      </header>

      <section className="workspace-grid">
        <form className="lookup-panel" onSubmit={onSubmit}>
          <div className="panel-heading">
            <div>
              <span className="eyeline">Lookup</span>
              <h2>Latin passage</h2>
            </div>
            <button className="primary-button" type="submit" disabled={loading || !text.trim()}>
              {loading ? <Loader2 className="spin" size={18} /> : <Search size={18} />}
              Analyze
            </button>
          </div>

          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
            aria-label="Latin passage"
          />

          {error ? <div className="error-banner">{error}</div> : null}
        </form>

        <aside className="saved-panel">
          <div className="panel-heading compact">
            <div>
              <span className="eyeline">Review</span>
              <h2>Study list</h2>
            </div>
            <span className="saved-count">{savedTerms.length}</span>
          </div>

          <div className="export-actions">
            <button className="secondary-button" type="button" onClick={copyStudyList} disabled={!savedTerms.length}>
              <Clipboard size={16} />
              Copy TSV
            </button>
            <button className="secondary-button" type="button" onClick={downloadStudyList} disabled={!savedTerms.length}>
              <Download size={16} />
              Download TSV
            </button>
            {exportStatus ? <span className="export-status">{exportStatus}</span> : null}
          </div>

          {savedTerms.length ? (
            <textarea
              className="export-preview"
              value={exportText}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
              aria-label="Study list TSV"
            />
          ) : null}

          <div className="saved-list">
            {savedTerms.length ? (
              savedTerms.map((term) => (
                <article className="saved-term" key={term.id}>
                  <div>
                    <strong>{exportHeadword(term)}</strong>
                    <p>{term.sense}</p>
                  </div>
                  <button className="icon-button subtle" type="button" onClick={() => removeTerm(term.id)} aria-label="Remove term">
                    <Trash2 size={16} />
                  </button>
                </article>
              ))
            ) : (
              <div className="empty-state">No saved terms</div>
            )}
          </div>
        </aside>
      </section>

      <section className="results-grid">
        <nav className="tokens-panel" aria-label="Parsed tokens">
          <div className="section-title">
            <span className="eyeline">Words</span>
            <h2>Parsed words</h2>
          </div>

          <div className="token-list">
            {result?.tokens.length ? (
              result.tokens.map((token, index) => (
                <TokenButton
                  key={`${token.word}-${index}`}
                  token={token}
                  selected={index === selectedIndex}
                  onSelect={() => setSelectedIndex(index)}
                />
              ))
            ) : (
              <div className="empty-state">No parsed words</div>
            )}
          </div>
        </nav>

        <section className="detail-panel">
          <div className="section-title split">
            <div>
              <span className="eyeline">Analysis</span>
              <h2>{selectedToken?.word ?? "Select a word"}</h2>
            </div>
            {selectedToken ? <span className="match-count">{selectedToken.defs.length} definitions</span> : null}
          </div>

          <div className="definition-list">
            {selectedToken?.defs.length ? (
              selectedToken.defs.map((definition, index) => (
                <DefinitionRow
                  key={`${lemmaFor(definition)}-${index}`}
                  definition={definition}
                  onSave={() => saveTerm(selectedToken, definition)}
                  isSaved={savedIds.has(`${selectedToken.word}:${lemmaFor(definition)}:${firstSense(definition)}`)}
                />
              ))
            ) : (
              <div className="empty-state">No definitions</div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
