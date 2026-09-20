/**
 * The Fact gate.
 *
 * A claim is only stored if the words it cites actually appear in the source.
 * No span, no Fact -- not "store it with confidence 0.4 anyway".
 * See docs/second-brain/04 principle 2 and 03 (LangExtract's contract).
 *
 * Deliberately NOT fuzzy. There is no similarity score and no threshold here,
 * because a near-miss is exactly what a language model produces when it is
 * being helpful, and accepting near-misses is how fabricated quotes get in.
 * Every allowance is a NAMED, individually-toggleable rule, so a reviewer can
 * see precisely what was forgiven.
 */

export type NormalizationRule =
  | 'trim'                 // leading/trailing whitespace on the excerpt
  | 'collapse_whitespace'  // runs of whitespace (incl. newlines) treated as one space
  | 'unify_quotes'         // curly quotes/apostrophes and dashes vs their ASCII forms
  | 'unicode_form';        // NFC vs NFD -- "é" typed two different ways

export const ALL_RULES: NormalizationRule[] = [
  'trim',
  'collapse_whitespace',
  'unify_quotes',
  'unicode_form',
];

export interface VerifyOptions {
  /** Which allowances are permitted. Default: all. Pass [] for byte-exact only. */
  rules?: NormalizationRule[];
  /** Reject excerpts shorter than this. Guards against a Fact "grounded" in "I". */
  minLength?: number;
}

export type VerifyResult =
  | { ok: true; charStart: number; charEnd: number; matchedText: string; exact: boolean }
  | { ok: false; reason: VerifyFailure };

export type VerifyFailure =
  | 'empty_excerpt'
  | 'excerpt_too_short'
  | 'empty_source'
  | 'not_found';

const QUOTE_MAP: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"',
  '′': "'", '″': '"',
  '–': '-', '—': '-', '−': '-',
  ' ': ' ',
};

/**
 * Normalize while keeping a map back to original indices.
 * map[i] = index in `input` that produced normalized character i.
 */
function normalizeWithMap(
  input: string,
  rules: Set<NormalizationRule>
): { text: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  let lastWasSpace = false;

  for (let i = 0; i < input.length; i += 1) {
    let ch = input[i];

    if (/\s/.test(ch)) {
      if (rules.has('collapse_whitespace')) {
        if (lastWasSpace) continue;
        out.push(' ');
        map.push(i);
        lastWasSpace = true;
        continue;
      }
      out.push(ch);
      map.push(i);
      lastWasSpace = false;
      continue;
    }
    lastWasSpace = false;

    if (rules.has('unify_quotes') && QUOTE_MAP[ch]) ch = QUOTE_MAP[ch];

    if (rules.has('unicode_form')) {
      // Decompose so "é" written as one char and as e+accent both land on the
      // same sequence. Every produced char maps back to this source index.
      const decomposed = ch.normalize('NFD');
      for (const d of decomposed) {
        out.push(d);
        map.push(i);
      }
      continue;
    }

    out.push(ch);
    map.push(i);
  }

  return { text: out.join(''), map };
}

/**
 * Does `excerpt` genuinely appear in `source`?
 *
 * Returns offsets into the ORIGINAL source, so a caller can later show the
 * sentence exactly as the person wrote it.
 */
export function verifyExcerpt(
  excerpt: string,
  source: string,
  options: VerifyOptions = {}
): VerifyResult {
  const rules = new Set(options.rules ?? ALL_RULES);
  const minLength = options.minLength ?? 3;

  if (!excerpt) return { ok: false, reason: 'empty_excerpt' };
  if (!source) return { ok: false, reason: 'empty_source' };

  const candidate = rules.has('trim') ? excerpt.trim() : excerpt;
  if (!candidate) return { ok: false, reason: 'empty_excerpt' };
  if (candidate.trim().length < minLength) return { ok: false, reason: 'excerpt_too_short' };

  // Fast path: byte-exact, no allowances needed.
  const exactAt = source.indexOf(candidate);
  if (exactAt !== -1) {
    return {
      ok: true,
      charStart: exactAt,
      charEnd: exactAt + candidate.length,
      matchedText: source.slice(exactAt, exactAt + candidate.length),
      exact: true,
    };
  }

  if (rules.size === 0) return { ok: false, reason: 'not_found' };

  const src = normalizeWithMap(source, rules);
  const exc = normalizeWithMap(candidate, rules);
  if (!exc.text) return { ok: false, reason: 'empty_excerpt' };

  const at = src.text.indexOf(exc.text);
  if (at === -1) return { ok: false, reason: 'not_found' };

  const charStart = src.map[at];
  const lastNormalizedIndex = at + exc.text.length - 1;
  const charEnd = src.map[lastNormalizedIndex] + 1;

  return {
    ok: true,
    charStart,
    charEnd,
    matchedText: source.slice(charStart, charEnd),
    exact: false,
  };
}
