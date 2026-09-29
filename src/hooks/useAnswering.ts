import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { LlmAskPayload } from '../../shared/protocol';
import { isLikelyQuestion } from '../../shared/textHeuristics';
import { pickContinuousQuestion, type TranscriptSegment } from '../../shared/transcript';
import type { MicCapture } from '../audio/micCapture';
import type { AnswerTurn } from '../components/AnswerSession';
import type { Dict } from '../i18n';
import { uid, type SessionsApi } from './useSessions';
import type { ShotQueueApi } from './useShotQueue';

// v2: only the last 8 turns ride along verbatim — the rolling memo carries
// older context, keeping per-request tokens flat as the interview runs long
const HISTORY_TURNS = 8;
/** an answer waits at most this long for the interviewer sentence ASR is still finalizing */
const PARTIAL_WAIT_MS = 3000;
/** … and at most this long for queued screenshots still being extracted */
const EXTRACT_WAIT_MS = 30000;

/**
 * Model requests from the answer pane and the transcript: answers (答 / 持续 /
 * 问), screenshot questions, bubble translation and cancel; the continuous
 * mode auto trigger; streaming the replies into their turns and folding each
 * finished answer into the session's rolling memo.
 */
export function useAnswering({
  sessions,
  shots,
  partialsRef,
  mic,
  tRef,
}: {
  sessions: SessionsApi;
  shots: ShotQueueApi;
  partialsRef: RefObject<{ them?: string; me?: string }>;
  /** while it runs, the <interviewee> transcript lines replace earlier answers */
  mic: MicCapture;
  tRef: RefObject<Dict>;
}) {
  const { sessionsRef, currentIdRef, answeredRef, setSessions, patchSession, appendTurn, currentMaterial, maybeTitle } =
    sessions;
  const { shotQueuesRef } = shots;
  const [continuous, setContinuous] = useState(false);
  // P1-5: one memo update at a time per session (promise chain)
  const memoChain = useRef(new Map<string, Promise<void>>());

  useEffect(
    () =>
      window.mc.onLlmEvent((ev) => {
        // all sessions: a request keeps streaming into its own session after
        // the user switches to another one
        setSessions((list) =>
          list.map((s) => ({
            ...s,
            turns: s.turns.map((t) => {
              if (t.id !== ev.requestId) return t;
              if (ev.kind === 'delta') return { ...t, text: t.text + ev.text };
              if (ev.kind === 'done') return { ...t, text: ev.text || t.text, status: 'done' };
              return { ...t, status: 'error', error: ev.message };
            }),
          })),
        );
        if (ev.kind !== 'done') return;
        // fold a finished interview answer into the session memo, async and
        // never on the answer critical path; a typed 问 question is a side
        // chat with the AI and stays out
        const s = sessionsRef.current.find((x) => x.turns.some((t) => t.id === ev.requestId));
        const t = s?.turns.find((x) => x.id === ev.requestId);
        if (!s || !t || (t.kind !== 'segment' && t.kind !== 'continuous')) return;
        const question = t.question ?? t.label;
        const answer = ev.text || t.text;
        if (!answer.trim()) return;
        const sid = s.id;
        const next = (memoChain.current.get(sid) ?? Promise.resolve())
          .then(async () => {
            const old = sessionsRef.current.find((x) => x.id === sid)?.memo ?? '';
            const memo = await window.mc.memoUpdate({ memo: old, question, answer });
            if (memo) patchSession(sid, (x) => ({ ...x, memo }));
          })
          .catch(() => {});
        memoChain.current.set(sid, next);
      }),
    [sessionsRef, setSessions, patchSession],
  );

  const askLlm = useCallback(
    async (mode: 'segment' | 'continuous' | 'free' | 'translate', text?: string) => {
      const sid = currentIdRef.current;
      if (!sid) return;
      const askedAt = Date.now();
      const answeredTs = answeredRef.current[sid] ?? 0;
      if (mode === 'continuous') {
        // nothing arrived since the previous continuous answer — the other
        // trigger got here first, or the hotkey was pressed twice: no repeat
        const segsNow = sessionsRef.current.find((x) => x.id === sid)?.segments ?? [];
        const anyNew =
          segsNow.some((g) => (g.speaker ?? 'them') === 'them' && g.endTs > answeredTs) ||
          !!partialsRef.current.them ||
          (shotQueuesRef.current[sid] ?? []).some((it) => it.at > answeredTs);
        if (!anyNew) return;
        answeredRef.current[sid] = askedAt;
      }
      const requestId = uid('req');
      appendTurn(sid, {
        id: requestId,
        kind: mode,
        label: text ?? (mode === 'continuous' ? tRef.current.app.latestRemark : ''),
        question: text ?? '',
        text: '',
        status: 'streaming',
      });
      if (mode === 'segment' || mode === 'free') maybeTitle(sid, text);

      // Wait for input the user has already given: the interviewer sentence
      // ASR is still finalizing (a partial turns into a segment ~1 s after
      // speech ends) and screenshots still being extracted. Sending at once
      // would leave out the question just asked / the screenshot just taken.
      if (mode !== 'translate') {
        const pending = () =>
          (mode === 'continuous' && !!partialsRef.current.them && Date.now() - askedAt < PARTIAL_WAIT_MS) ||
          ((shotQueuesRef.current[sid] ?? []).some((it) => it.status === 'extracting') &&
            Date.now() - askedAt < EXTRACT_WAIT_MS);
        if (pending()) {
          while (pending()) await new Promise((r) => setTimeout(r, 150));
          // stopped or cleared while waiting
          const turn = sessionsRef.current.find((x) => x.id === sid)?.turns.find((x) => x.id === requestId);
          if (turn?.status !== 'streaming') return;
        }
      }

      const session = sessionsRef.current.find((x) => x.id === sid);
      const recentSegs = (session?.segments ?? []).slice(-30);
      let question = text;
      if (mode === 'continuous') {
        // the turn label (and so the session history) carries the picked
        // interviewer lines instead of a constant '对方最新发言'
        const picked = pickContinuousQuestion(recentSegs, answeredTs);
        question = picked.question;
        answeredRef.current[sid] = Math.max(answeredRef.current[sid] ?? 0, picked.answeredUpTo);
        const label = question ?? tRef.current.app.latestRemark;
        patchSession(sid, (s) => ({
          ...s,
          turns: s.turns.map((t) => (t.id === requestId ? { ...t, label, question: question ?? '' } : t)),
        }));
      }
      // R6: cached extraction (E) from every screenshot currently queued for
      // this session — folded in as "visual context"
      const visualContext =
        mode === 'translate'
          ? undefined
          : (shotQueuesRef.current[sid] ?? []).filter((it) => it.status === 'ready' && it.text).map((it) => it.text!);
      // Earlier turns, last HISTORY_TURNS of each kind. Interview turns (答/持续)
      // only while the mic is off: with it on, the <interviewee> lines already
      // hold what I said. Typed 问 / 截图 turns are a side chat with the AI and
      // reach only the next 问.
      const done = (session?.turns ?? []).filter((t) => t.status === 'done');
      const pairs = (kinds: AnswerTurn['kind'][]) =>
        done
          .filter((t) => kinds.includes(t.kind))
          .slice(-HISTORY_TURNS)
          .map((t) => ({ question: t.question ?? t.label, answer: t.text }));
      const payload: LlmAskPayload = {
        requestId,
        sessionId: sid,
        mode,
        question: mode === 'free' ? undefined : question,
        freeQuestion: mode === 'free' ? text : undefined,
        transcript: recentSegs.map((s) => ({ id: s.id, speaker: s.speaker ?? 'them', text: s.text })),
        earlierAnswers: mode === 'translate' ? undefined : mic.running ? [] : pairs(['segment', 'continuous']),
        chatHistory: mode === 'free' ? pairs(['free', 'vision']) : undefined,
        visualContext: visualContext?.length ? visualContext : undefined,
        ...(mode === 'translate' ? {} : currentMaterial()),
      };
      window.mc.llmAsk(payload);
    },
    [sessionsRef, currentIdRef, answeredRef, shotQueuesRef, partialsRef, mic, tRef, appendTurn, currentMaterial, maybeTitle, patchSession],
  );

  const askShot = useCallback(
    (question: string, imageDataUrl?: string) => {
      const sid = currentIdRef.current;
      if (!sid) return;
      const requestId = uid('shot');
      appendTurn(sid, {
        id: requestId,
        kind: 'vision',
        label: question || tRef.current.app.readShot,
        question,
        text: '',
        status: 'streaming',
      });
      maybeTitle(sid, question || tRef.current.app.shotQuestion);
      const m = currentMaterial();
      const background = [m.resume, m.jd].filter(Boolean).join('\n\n') || undefined;
      window.mc.shotAsk({ requestId, question, background, imageDataUrl });
    },
    [currentIdRef, tRef, appendTurn, currentMaterial, maybeTitle],
  );

  const cancelTurn = useCallback(
    (id: string) => {
      window.mc.llmCancel(id);
      patchSession(currentIdRef.current, (s) => ({
        ...s,
        turns: s.turns.map((t) => (t.id === id ? { ...t, status: 'done' } : t)),
      }));
    },
    [currentIdRef, patchSession],
  );

  /** inline 译 on one transcript bubble (original/translation side by side) */
  const translateSegment = useCallback(
    (seg: TranscriptSegment) => {
      if (seg.translating) return; // re-translating an already-translated bubble is allowed
      const sid = currentIdRef.current;
      const setSeg = (patch: Partial<TranscriptSegment>) =>
        patchSession(sid, (s) => ({
          ...s,
          segments: (s.segments ?? []).map((g) => (g.id === seg.id ? { ...g, ...patch } : g)),
        }));
      setSeg({ translating: true });
      window.mc
        .translate(seg.text)
        .then((zh) => setSeg({ translation: zh, translating: false }))
        .catch(() => setSeg({ translation: tRef.current.app.translateFail, translating: false }));
    },
    [currentIdRef, tRef, patchSession],
  );

  // continuous mode: only the OTHER party's questions trigger it (never my own
  // mic), question-gated + append, per current session.
  const segments = sessions.current?.segments ?? [];
  const lastSeg = segments.length ? segments[segments.length - 1] : null;
  useEffect(() => {
    if (!continuous || !lastSeg) return;
    if ((lastSeg.speaker ?? 'them') !== 'them') return; // ignore my own voice
    if (!isLikelyQuestion(lastSeg.text)) return;
    const timer = setTimeout(() => {
      // already covered by an answer asked after this line ended (the answer
      // hotkey pressed within the 1.1 s, or while that answer waited on ASR)
      if ((answeredRef.current[currentIdRef.current] ?? 0) < lastSeg.endTs) void askLlm('continuous');
    }, 1100);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continuous, lastSeg?.id, lastSeg?.endTs]);

  return { continuous, setContinuous, askLlm, askShot, cancelTurn, translateSegment };
}
