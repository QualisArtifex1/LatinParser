export type MorphValue = string | number | string[] | undefined;

export type MorphForm = Record<string, MorphValue>;

export interface Inflection {
  ending: string;
  pos: string;
  form: MorphForm;
}

export interface Definition {
  orth: string[];
  senses: string[];
  infls: Inflection[];
  entry?: {
    pos: string;
    gender?: string;
  };
}

export interface TokenResult {
  word: string;
  defs: Definition[];
}

export interface ParseStats {
  tokens: number;
  matched: number;
  definitions: number;
  forms: number;
}

export interface ParseResponse {
  input: string;
  tokens: TokenResult[];
  stats: ParseStats;
  generated_at: string;
}

export interface SavedTerm {
  id: string;
  word: string;
  lemma: string;
  sense: string;
  pos: string;
  gender?: string;
}
