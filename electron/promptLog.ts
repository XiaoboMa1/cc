/**
 * Opt-in local debug log of what the answerer model actually receives and
 * returns. OFF unless MC_PROMPT_LOG=<file path> is set; nothing here is
 * uploaded or folded into buildDiagnosticsReport, which deliberately excludes
 * transcripts/answers from the one report a user might share (diagnostics.ts).
 *
 * The recent-transcript window resent on every ask is the redundant part:
 * each call carries up to 30 segments, and consecutive asks in the same
 * session overlap almost entirely. This tracks, per session, which segment
 * ids have already been written to the log and logs only the ones that
 * haven't — the prompt actually SENT to the model (built from the full
 * window) is untouched; only what lands on disk is trimmed.
 */
import type { TranscriptLine } from '../shared/protocol';

const loggedIdsBySession = new Map<string, Set<number>>();

/** New segments (not yet logged for this session) + how many were skipped as
 * already-logged. Mutates the per-session bookkeeping. */
export function diffTranscriptForLog(
  sessionId: string,
  window: readonly TranscriptLine[],
): { newLines: TranscriptLine[]; carriedOverCount: number } {
  let seen = loggedIdsBySession.get(sessionId);
  if (!seen) {
    seen = new Set();
    loggedIdsBySession.set(sessionId, seen);
  }
  const newLines: TranscriptLine[] = [];
  let carriedOverCount = 0;
  for (const line of window) {
    if (seen.has(line.id)) {
      carriedOverCount++;
    } else {
      newLines.push(line);
      seen.add(line.id);
    }
  }
  return { newLines, carriedOverCount };
}

/**
 * Segment ids are assigned as `max(current list) + 1` (shared/transcript's
 * nextSegmentId), so a transcript clear resets numbering and a later segment
 * can reuse an id this module already marked "logged" for different text.
 * Call this after every sessions-save with each session's CURRENT segment
 * ids; if the tracked high-water mark no longer exists, the list was
 * cleared/reindexed, so drop the dedup state and let it rebuild from
 * scratch instead of silently hiding a same-numbered but unrelated segment.
 */
export function syncPromptLogSession(sessionId: string, currentIds: readonly number[]): void {
  const seen = loggedIdsBySession.get(sessionId);
  if (!seen || seen.size === 0) return;
  const maxCurrent = currentIds.length ? Math.max(...currentIds) : 0;
  const maxLogged = Math.max(...seen);
  if (maxCurrent < maxLogged) seen.clear();
}

export function clearPromptLogState(): void {
  loggedIdsBySession.clear();
}

function formatMessage(m: { role: string; content: unknown }): string {
  const content = typeof m.content === 'string' ? m.content : '[multimodal content omitted]';
  return `[${m.role}]\n${content}`;
}

export interface PromptLogRequestInput {
  at: string;
  sessionId: string;
  requestId: string;
  mode: string;
  messages: { role: string; content: unknown }[];
  newLineCount: number;
  carriedOverCount: number;
}

export function formatPromptLogRequest(e: PromptLogRequestInput): string {
  const lines = [`===== REQUEST ${e.requestId} (${e.mode}) session=${e.sessionId} at=${e.at} =====`];
  if (e.newLineCount || e.carriedOverCount) {
    lines.push(
      `[transcript window: ${e.newLineCount} new line(s) below, ${e.carriedOverCount} already logged earlier this session — omitted]`,
    );
  }
  lines.push(...e.messages.map(formatMessage), '');
  return lines.join('\n');
}

export function formatPromptLogResponse(requestId: string, text: string): string {
  return [`----- RESPONSE ${requestId} -----`, text, ''].join('\n');
}

export function formatPromptLogError(requestId: string, message: string): string {
  return [`----- ERROR ${requestId} -----`, message, ''].join('\n');
}
