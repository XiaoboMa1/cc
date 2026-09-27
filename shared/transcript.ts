/**
 * Transcript assembly: pure logic, unit-tested.
 * Lesson from Natively: STT can split one sentence into fragments — merge
 * same-speaker segments that arrive close together, capped in length.
 */

export interface TranscriptSegment {
  id: number;
  text: string;
  lang?: string;
  /** 'them' (system audio) | 'me' (microphone); default 'them' */
  speaker?: 'them' | 'me';
  /** inline Chinese translation (off-session, user-triggered) */
  translation?: string;
  translating?: boolean;
  /** Date.now() of speech start/end (from ASR timings) */
  startTs: number;
  endTs: number;
  /** end-to-end latency (speech end -> rendered), for the HUD */
  e2eMs?: number;
  inferMs?: number;
}

export interface AppendOptions {
  mergeWindowMs: number;
  maxMergedChars: number;
  maxSegments: number;
  /** a bubble that ended at or before this Date.now() is closed to merging:
   * an answer request already covered it, so later words start a new bubble
   * instead of turning the answered bubble into a new question */
  closedUntil?: number;
}

export const DEFAULT_APPEND_OPTIONS: AppendOptions = {
  mergeWindowMs: 2500,
  maxMergedChars: 600,
  maxSegments: 500,
};

const CJK_RE = /[぀-ヿ㐀-鿿豈-﫿]/;

/** Join two texts; no space between CJK boundaries, single space otherwise. */
export function joinTexts(a: string, b: string): string {
  const left = a.trimEnd();
  const right = b.trimStart();
  if (!left) return right;
  if (!right) return left;
  const lc = left[left.length - 1];
  const rc = right[0];
  if (CJK_RE.test(lc) || CJK_RE.test(rc)) return left + right;
  return `${left} ${right}`;
}

/**
 * Append a segment, merging into the previous one when it arrives within
 * mergeWindowMs of the previous end and the merged text stays short enough.
 * Returns a NEW array (react-friendly); drops oldest beyond maxSegments.
 */
export function appendSegment(
  list: readonly TranscriptSegment[],
  seg: TranscriptSegment,
  opts: AppendOptions = DEFAULT_APPEND_OPTIONS,
): TranscriptSegment[] {
  const text = seg.text.trim();
  if (!text) return [...list];

  const last = list[list.length - 1];
  // only merge fragments from the SAME speaker (dual-channel: 对方 vs 我);
  // never into a bubble that is translated/translating (译文会与合并后原文错位)
  // or already answered
  if (
    last &&
    (last.speaker ?? 'them') === (seg.speaker ?? 'them') &&
    !last.translation &&
    !last.translating &&
    last.endTs > (opts.closedUntil ?? 0)
  ) {
    const gap = seg.startTs - last.endTs;
    const merged = joinTexts(last.text, text);
    // small negative gaps happen when pre-roll audio overlaps the previous tail
    if (gap >= -750 && gap <= opts.mergeWindowMs && merged.length <= opts.maxMergedChars) {
      const next = list.slice(0, -1);
      next.push({
        ...last,
        text: merged,
        endTs: seg.endTs,
        lang: seg.lang ?? last.lang,
        e2eMs: seg.e2eMs,
        inferMs: seg.inferMs,
      });
      return next;
    }
  }

  const next = [...list, { ...seg, text }];
  if (next.length > opts.maxSegments) next.splice(0, next.length - opts.maxSegments);
  return next;
}

/**
 * Next UI-unique segment id for a session's list. The worker's own segment
 * counter resets on every engine rebuild, so its ids DUPLICATE across the
 * lifetime of a persisted session — translations keyed by id then land on
 * every bubble sharing it (and React keys collide). Always derive the id
 * from what the session already holds.
 */
export function nextSegmentId(list: readonly TranscriptSegment[]): number {
  let max = 0;
  for (const s of list) if (s.id > max) max = s.id;
  return max + 1;
}

/** re-id a legacy list sequentially (heals persisted duplicate ids). */
export function reindexSegments(list: readonly TranscriptSegment[]): TranscriptSegment[] {
  return list.map((s, i) => ({ ...s, id: i + 1 }));
}

/** p50/p95 helper for the latency HUD. */
export function percentile(values: readonly number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((x, y) => x - y);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/**
 * The question of a continuous answer (K-A or the answer hotkey): every
 * interviewer ('them') line that ended after `answeredTs`, joined, so one
 * question asked over several sentences is answered as one. With no new line
 * (only new screenshots) it is the latest interviewer line again.
 * `answeredUpTo` is the newest endTs among the new lines (0 when none).
 */
export function pickContinuousQuestion(
  segments: readonly TranscriptSegment[],
  answeredTs: number,
): { question: string | undefined; answeredUpTo: number } {
  const theirs = segments.filter((g) => (g.speaker ?? 'them') === 'them');
  const fresh = theirs.filter((g) => g.endTs > answeredTs);
  return {
    question: (fresh.length ? fresh : theirs.slice(-1)).map((g) => g.text).join('\n') || undefined,
    answeredUpTo: Math.max(0, ...fresh.map((g) => g.endTs)),
  };
}
