/**
 * Reading a two-person conversation transcript, keeping only the person's words.
 *
 * Meeting notes (Granola) label each turn "Me:" or "Them:". Imported whole,
 * the other person's opinions would become claims about the user -- the same
 * failure as someone else's document in their Drive. So only "Me:" turns are
 * kept, and of those only ones with substance: "Yeah.", "Mm-hmm." and "Okay"
 * carry nothing and would only dilute what the model reads.
 *
 * Any line that is not a labelled turn (a header, an editor's note) is never
 * attributed to anyone.
 */

export interface Turn { speaker: 'me' | 'them'; text: string }

export interface ParsedTranscript {
  title: string | null;
  turns: Turn[];
}

const TURN = /^(Me|Them):\s?(.*)$/;

export function parseTranscript(text: string): ParsedTranscript {
  const title = /^Meeting Title:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? null;
  const turns: Turn[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = TURN.exec(line);
    if (!m) continue;
    turns.push({ speaker: m[1] === 'Me' ? 'me' : 'them', text: m[2]!.trim() });
  }
  return { title, turns };
}

/** Words in a turn, not counting filler that says nothing. */
function substantiveWords(text: string): number {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w)).length;
}
const FILLER = new Set(['yeah', 'yep', 'yes', 'okay', 'ok', 'mm', 'hmm', 'mm-hmm', 'uh', 'um', 'huh', 'right', 'dude', 'man', 'oh', 'wow', 'nice', 'cool', 'sure']);

/** The person's own turns worth reading, in order. */
export function ownTurns(turns: Turn[], minWords = 5): string[] {
  return turns.filter((t) => t.speaker === 'me' && substantiveWords(t.text) >= minWords).map((t) => t.text);
}
