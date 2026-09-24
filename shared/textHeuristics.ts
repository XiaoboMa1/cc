/**
 * Pure text heuristics for the renderer's continuous-mode (K-A) gate. Kept in
 * shared/ so tests reach it without importing across the electron/renderer
 * project boundary.
 */

const QUESTION_WORDS =
  /(what|how|why|whether|can you|could you|is it possible|should we|is there|please|talk about|discuss|introduce|tell me|explain|what do you think|how do you see|how many|which|\?|\bwhen\b|\bwhere\b|\bwould you\b)/i;

/**
 * Does the other party's line look like a question worth auto-answering
 * (continuous-mode gate, to avoid answering every fragment)?
 */
export function isLikelyQuestion(text: string): boolean {
  const t = text.trim();
  if (t.length < 4) return false;
  if (/[?？]$/.test(t)) return true;
  if (QUESTION_WORDS.test(t)) return true;
  // long utterances often carry an implicit ask even without a marker
  return t.length >= 40;
}
