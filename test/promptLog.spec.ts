import { describe, expect, it } from 'vitest';
import {
  clearPromptLogState,
  diffTranscriptForLog,
  formatPromptLogError,
  formatPromptLogRequest,
  formatPromptLogResponse,
  syncPromptLogSession,
} from '../electron/promptLog';
import type { TranscriptLine } from '../shared/protocol';

function line(id: number, speaker: 'them' | 'me', text: string): TranscriptLine {
  return { id, speaker, text };
}

describe('diffTranscriptForLog', () => {
  it('logs everything on the first call for a session', () => {
    clearPromptLogState();
    const { newLines, carriedOverCount } = diffTranscriptForLog('s1', [
      line(1, 'them', 'a'),
      line(2, 'me', 'b'),
    ]);
    expect(newLines).toEqual([line(1, 'them', 'a'), line(2, 'me', 'b')]);
    expect(carriedOverCount).toBe(0);
  });

  it('omits ids already logged for the same session on a later call', () => {
    clearPromptLogState();
    diffTranscriptForLog('s1', [line(1, 'them', 'a'), line(2, 'me', 'b')]);
    const { newLines, carriedOverCount } = diffTranscriptForLog('s1', [
      line(1, 'them', 'a'),
      line(2, 'me', 'b'),
      line(3, 'them', 'c'),
    ]);
    expect(newLines).toEqual([line(3, 'them', 'c')]);
    expect(carriedOverCount).toBe(2);
  });

  it('keeps sessions independent', () => {
    clearPromptLogState();
    diffTranscriptForLog('s1', [line(1, 'them', 'a')]);
    const { newLines, carriedOverCount } = diffTranscriptForLog('s2', [line(1, 'them', 'a')]);
    expect(newLines).toEqual([line(1, 'them', 'a')]);
    expect(carriedOverCount).toBe(0);
  });
});

describe('syncPromptLogSession', () => {
  it('forgets logged ids once the live list no longer reaches the previous high-water mark (transcript cleared)', () => {
    clearPromptLogState();
    diffTranscriptForLog('s1', [line(1, 'them', 'a'), line(2, 'me', 'b'), line(3, 'them', 'c')]);
    // renderer cleared the transcript: next segment reuses id 1 for unrelated text
    syncPromptLogSession('s1', []);
    const { newLines, carriedOverCount } = diffTranscriptForLog('s1', [line(1, 'them', 'brand new text')]);
    expect(newLines).toEqual([line(1, 'them', 'brand new text')]);
    expect(carriedOverCount).toBe(0);
  });

  it('leaves dedup state alone when the live list still covers what was logged', () => {
    clearPromptLogState();
    diffTranscriptForLog('s1', [line(1, 'them', 'a'), line(2, 'me', 'b')]);
    syncPromptLogSession('s1', [1, 2, 3]);
    const { newLines, carriedOverCount } = diffTranscriptForLog('s1', [line(1, 'them', 'a'), line(2, 'me', 'b')]);
    expect(newLines).toEqual([]);
    expect(carriedOverCount).toBe(2);
  });
});

describe('formatPromptLogRequest / Response / Error', () => {
  it('renders a request with the new/carried-over transcript note and messages', () => {
    const out = formatPromptLogRequest({
      at: '2026-09-24T00:00:00.000Z',
      sessionId: 's1',
      requestId: 'req-1',
      mode: 'segment',
      messages: [
        { role: 'system', content: 'persona' },
        { role: 'user', content: 'question' },
      ],
      newLineCount: 1,
      carriedOverCount: 5,
    });
    expect(out).toContain('REQUEST req-1 (segment) session=s1');
    expect(out).toContain('[transcript window: 1 new line(s) below, 5 already logged earlier this session — omitted]');
    expect(out).toContain('[system]\npersona');
    expect(out).toContain('[user]\nquestion');
  });

  it('omits the transcript note when there is nothing to report', () => {
    const out = formatPromptLogRequest({
      at: '2026-09-24T00:00:00.000Z',
      sessionId: 's1',
      requestId: 'req-1',
      mode: 'translate',
      messages: [{ role: 'user', content: 'x' }],
      newLineCount: 0,
      carriedOverCount: 0,
    });
    expect(out).not.toContain('transcript window');
  });

  it('response and error entries carry the requestId and body', () => {
    expect(formatPromptLogResponse('req-1', 'the answer')).toContain('RESPONSE req-1');
    expect(formatPromptLogResponse('req-1', 'the answer')).toContain('the answer');
    expect(formatPromptLogError('req-1', 'boom')).toContain('ERROR req-1');
    expect(formatPromptLogError('req-1', 'boom')).toContain('boom');
  });
});
