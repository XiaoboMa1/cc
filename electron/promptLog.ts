/**
 * Opt-in local debug log of what the answerer model actually receives and
 * returns. OFF unless `--debug-log` / MC_DEBUG_LOG / MC_PROMPT_LOG=<file path>
 * is set (electron/llmIpc.ts PROMPT_LOG_PATH, which also writes the file);
 * nothing here is uploaded or folded into buildDiagnosticsReport, which
 * deliberately excludes transcripts/answers from the one report a user might
 * share (diagnostics.ts).
 *
 * The recent-transcript window resent on every ask is the redundant part:
 * each call carries up to 30 segments, and consecutive asks in the same
 * session overlap almost entirely. This tracks, per session, which segment
 * ids have already been written to the log and logs only the ones that
 * haven't — the prompt actually SENT to the model (built from the full
 * window) is untouched; only what lands on disk is trimmed. The system
 * message is the other repeated part: it is written in full the first time
 * its exact text appears in the file, then as one line naming that request.
 */
import type { TranscriptLine } from '../shared/protocol';

const loggedIdsBySession = new Map<string, Set<number>>();
/** system message text -> the request that wrote it in full */
const loggedSystem = new Map<string, string>();

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
  loggedSystem.clear();
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

/** Mutates the system-message bookkeeping: call once per request written. */
export function formatPromptLogRequest(e: PromptLogRequestInput): string {
  const lines = [`===== REQUEST ${e.requestId} (${e.mode}) session=${e.sessionId} at=${e.at} =====`];
  if (e.newLineCount || e.carriedOverCount) {
    lines.push(
      `[transcript window: ${e.newLineCount} new line(s) below, ${e.carriedOverCount} already logged earlier this session — omitted]`,
    );
  }
  for (const m of e.messages) {
    const content = typeof m.content === 'string' ? m.content : '[multimodal content omitted]';
    const first = m.role === 'system' ? loggedSystem.get(content) : undefined;
    if (first) {
      lines.push(`[system] same as REQUEST ${first}`);
      continue;
    }
    if (m.role === 'system') loggedSystem.set(content, e.requestId);
    lines.push(`[${m.role}]\n${content}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function formatPromptLogResponse(requestId: string, text: string): string {
  return [`----- RESPONSE ${requestId} -----`, text, ''].join('\n');
}

export function formatPromptLogError(requestId: string, message: string): string {
  return [`----- ERROR ${requestId} -----`, message, ''].join('\n');
}
