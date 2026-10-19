/** Splitting long text without losing or changing a character. Shared by the
 *  question store (what the model is shown) and extraction (long entries). */

/**
 * Split text into sections near `size`, breaking at a paragraph if possible,
 * otherwise at a sentence, never mid-word. Joined back, the sections are the
 * original text.
 */
export function splitIntoSections(text: string, size: number): string[] {
  if (text.length <= size * 1.25) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > size * 1.25) {
    const window = rest.slice(0, size);
    const cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('. '), window.lastIndexOf('\n'));
    const at = cut > size * 0.5 ? cut + 1 : (window.lastIndexOf(' ') > 0 ? window.lastIndexOf(' ') + 1 : size);
    out.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  out.push(rest);
  return out;
}
