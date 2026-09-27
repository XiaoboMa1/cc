import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { InterviewType, KbSlot, StoredSession } from '../../shared/protocol';
import {
  DEFAULT_APPEND_OPTIONS,
  appendSegment,
  nextSegmentId,
  reindexSegments,
  type TranscriptSegment,
} from '../../shared/transcript';
import type { AnswerTurn } from '../components/AnswerSession';
import type { Dict } from '../i18n';

const MAX_TURNS = 200;

let seq = 0;
/** renderer-unique id for a session, a request or a screenshot */
export const uid = (p: string) => `${p}-${++seq}-${Date.now()}`;

function newSession(name: string, interviewType: InterviewType = 'tech'): StoredSession {
  return { id: uid('s'), name, createdAt: Date.now(), turns: [], segments: [], interviewType };
}

export type SessionsApi = ReturnType<typeof useSessions>;

/**
 * The session list — each session holds its transcript, answer turns, resume
 * / JD, memo and interview type — loaded once from main and saved back 400 ms
 * after the last change. Callbacks read sessionsRef / currentIdRef instead of
 * state, so they stay stable and see writes made before React re-renders.
 */
export function useSessions(tRef: RefObject<Dict>) {
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [currentId, setCurrentId] = useState('');
  /** transient resume / JD parse warning (e.g. scanned PDF with no text layer) */
  const [kbNotice, setKbNotice] = useState<string | null>(null);
  const sessionsRef = useRef<StoredSession[]>([]);
  const currentIdRef = useRef('');
  // per session: interviewer lines that ended at or before this Date.now() are
  // already put to a continuous answer (K-A or the answer hotkey). A ref, not
  // session state: both triggers can fire before React re-renders.
  const answeredRef = useRef<Record<string, number>>({});
  const loaded = useRef(false);
  sessionsRef.current = sessions;
  currentIdRef.current = currentId;

  const current = useMemo(() => sessions.find((s) => s.id === currentId) ?? null, [sessions, currentId]);

  useEffect(() => {
    void window.mc.loadSessions().then((f) => {
      if (f.sessions.length) {
        setSessions(
          f.sessions.map((stored) => {
            // heal legacy duplicate segment ids (worker counter used to reset per
            // engine rebuild — translations then landed on multiple bubbles)
            const s = { ...stored, segments: reindexSegments(stored.segments ?? []) };
            // legacy single-slot KB → resume slot (dual-slot material, P0-2)
            if (!s.kbText || s.resumeText) return s;
            const { kbName, kbText, ...rest } = s;
            return { ...rest, resumeName: kbName ?? tRef.current.app.legacyKbName, resumeText: kbText };
          }),
        );
        setCurrentId(f.currentId && f.sessions.some((s) => s.id === f.currentId) ? f.currentId : f.sessions[0].id);
      } else {
        const s = newSession(tRef.current.app.sessionN(1));
        setSessions([s]);
        setCurrentId(s.id);
      }
      loaded.current = true;
    });
  }, [tRef]);

  useEffect(() => {
    if (!loaded.current) return;
    const timer = setTimeout(() => window.mc.saveSessions({ sessions, currentId }), 400);
    return () => clearTimeout(timer);
  }, [sessions, currentId]);

  useEffect(() => {
    if (!kbNotice) return;
    const timer = setTimeout(() => setKbNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [kbNotice]);

  const patchSession = useCallback((id: string, fn: (s: StoredSession) => StoredSession) => {
    setSessions((list) => list.map((s) => (s.id === id ? fn(s) : s)));
  }, []);

  const appendTurn = useCallback(
    (sessionId: string, turn: AnswerTurn) => {
      patchSession(sessionId, (s) => {
        const turns = [...s.turns, turn];
        return { ...s, turns: turns.length > MAX_TURNS ? turns.slice(turns.length - MAX_TURNS) : turns };
      });
    },
    [patchSession],
  );

  /** a final ASR segment joins the current session's transcript */
  const appendSegmentToCurrent = useCallback(
    (seg: Omit<TranscriptSegment, 'id'>) => {
      const sid = currentIdRef.current;
      patchSession(sid, (s) => ({
        ...s,
        segments: appendSegment(
          s.segments ?? [],
          // NOT the worker's segment id: its counter resets per engine rebuild,
          // duplicating ids inside a persisted session
          { ...seg, id: nextSegmentId(s.segments ?? []) },
          { ...DEFAULT_APPEND_OPTIONS, closedUntil: answeredRef.current[sid] },
        ),
      }));
    },
    [patchSession],
  );

  /** current session's prompt inputs: interview type + dual-slot material
   * (resume / JD / rolling memo) */
  const currentMaterial = useCallback((): {
    interviewType: InterviewType;
    resume?: string;
    jd?: string;
    memo?: string;
  } => {
    const s = sessionsRef.current.find((x) => x.id === currentIdRef.current);
    return {
      interviewType: s?.interviewType ?? 'tech',
      resume: s?.resumeText || undefined,
      jd: s?.jdText || undefined,
      memo: s?.memo || undefined,
    };
  }, []);

  /** P1-6: ask main to warm the DeepSeek prefix cache for the current material */
  const prewarm = useCallback(
    (immediate: boolean) => {
      const m = currentMaterial();
      window.mc.prewarm({ resume: m.resume, jd: m.jd, interviewType: m.interviewType, immediate });
    },
    [currentMaterial],
  );

  // switching sessions or interview type swaps the prefix → dirty (reheats if capturing)
  useEffect(() => {
    if (!loaded.current || !currentId) return;
    prewarm(false);
  }, [currentId, current?.interviewType, prewarm]);

  /** auto-name a session from its first real question (once) */
  const maybeTitle = useCallback(
    (sid: string, text?: string) => {
      const name = text?.replace(/\s+/g, ' ').trim();
      if (!name) return;
      patchSession(sid, (s) =>
        s.titled ? s : { ...s, name: name.length > 14 ? name.slice(0, 14) + '…' : name, titled: true },
      );
    },
    [patchSession],
  );

  const createSession = useCallback(() => {
    // a new session starts with the interview type of the one it is created from
    const from = sessionsRef.current.find((x) => x.id === currentIdRef.current);
    const s = newSession(tRef.current.app.sessionN(sessionsRef.current.length + 1), from?.interviewType);
    setSessions((list) => [...list, s]);
    setCurrentId(s.id);
  }, [tRef]);

  const deleteSession = useCallback(
    (id: string) => {
      setSessions((list) => {
        const next = list.filter((s) => s.id !== id);
        if (next.length === 0) {
          const s = newSession(tRef.current.app.sessionN(1));
          setCurrentId(s.id);
          return [s];
        }
        setCurrentId((cur) => (cur === id ? next[0].id : cur));
        return next;
      });
    },
    [tRef],
  );

  const renameSession = useCallback(
    (id: string, name: string) => {
      patchSession(id, (s) => ({ ...s, name: name.trim() || s.name, titled: true }));
    },
    [patchSession],
  );

  const clearTranscript = useCallback(() => {
    patchSession(currentIdRef.current, (s) => ({ ...s, segments: [] }));
  }, [patchSession]);

  const clearAnswers = useCallback(() => {
    patchSession(currentIdRef.current, (s) => ({ ...s, turns: [] }));
  }, [patchSession]);

  const toggleInterviewType = useCallback(() => {
    patchSession(currentIdRef.current, (s) => ({
      ...s,
      interviewType: (s.interviewType ?? 'tech') === 'tech' ? 'hr' : 'tech',
    }));
  }, [patchSession]);

  /** import a resume / JD document into the current session */
  const pickKb = useCallback(
    async (slot: KbSlot) => {
      const r = await window.mc.pickKnowledge(slot);
      if (!r) return;
      if (!r.text.trim()) {
        // deterministic parsers return '' for scanned/image-only PDFs
        setKbNotice(tRef.current.app.kbNoText(r.name));
        return;
      }
      setKbNotice(null);
      patchSession(currentIdRef.current, (s) =>
        slot === 'resume'
          ? { ...s, resumeName: r.name, resumeText: r.text }
          : { ...s, jdName: r.name, jdText: r.text },
      );
      // material changed → reheat the prefix cache with the fresh bytes;
      // patchSession is async (React state), so pass the new slot directly
      const m = currentMaterial();
      window.mc.prewarm({
        resume: slot === 'resume' ? r.text : m.resume,
        jd: slot === 'jd' ? r.text : m.jd,
        interviewType: m.interviewType,
        immediate: true,
      });
    },
    [tRef, patchSession, currentMaterial],
  );

  const clearKb = useCallback(
    (slot: KbSlot) => {
      patchSession(currentIdRef.current, (s) =>
        slot === 'resume'
          ? { ...s, resumeName: undefined, resumeText: undefined }
          : { ...s, jdName: undefined, jdText: undefined },
      );
      // prefix went stale; reheats now if capturing, else at the next ▶
      const m = currentMaterial();
      window.mc.prewarm({
        resume: slot === 'resume' ? undefined : m.resume,
        jd: slot === 'jd' ? undefined : m.jd,
        interviewType: m.interviewType,
      });
    },
    [patchSession, currentMaterial],
  );

  return {
    sessions,
    current,
    currentId,
    setCurrentId,
    sessionsRef,
    currentIdRef,
    answeredRef,
    kbNotice,
    setSessions,
    patchSession,
    appendTurn,
    appendSegment: appendSegmentToCurrent,
    currentMaterial,
    prewarm,
    maybeTitle,
    createSession,
    deleteSession,
    renameSession,
    clearTranscript,
    clearAnswers,
    toggleInterviewType,
    pickKb,
    clearKb,
  };
}
