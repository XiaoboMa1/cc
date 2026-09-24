import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { KbSlot, StoredSession } from '../../shared/protocol';
import { useT } from '../i18n';

export type TurnKind = 'segment' | 'continuous' | 'free' | 'translate' | 'vision';

export interface AnswerTurn {
  id: string;
  kind: TurnKind;
  label: string;
  text: string;
  status: 'streaming' | 'done' | 'error';
  error?: string;
}

/**
 * R6: one screenshot captured into the visual-context queue (Ctrl+H). The
 * image lives only in renderer memory (never persisted with the session);
 * `text` is the cached extraction (E) once `status` reaches 'ready'.
 */
export interface ShotQueueItem {
  id: string;
  dataUrl: string;
  status: 'extracting' | 'ready' | 'error';
  /** Date.now() when queued — a continuous answer with nothing newer than its previous one is skipped */
  at: number;
  text?: string;
  error?: string;
}

/** what App drives directly: the free-ask hotkey sends the typed question */
export interface AnswerSessionHandle {
  /** same as clicking 问 */
  submit(): void;
}

/**
 * 智能体 conversation panel (R4) with a multi-session bar. Answers ACCUMULATE
 * as a scrolling session (never replaced); each meeting is its own session
 * with its own knowledge base. The 📷 screenshot button only appears in
 * multimodal mode (it needs a vision model).
 */
export function AnswerSession({
  ref,
  sessions,
  currentId,
  turns,
  resumeName,
  resumeChars,
  jdName,
  jdChars,
  notice,
  visionReady,
  answersReady,
  answersHint,
  onSwitch,
  onNew,
  onDelete,
  onRename,
  onPickKb,
  onClearKb,
  onCancel,
  onClear,
  onFreeAsk,
  onShotAsk,
  shotQueue,
  onShotQueueRemove,
  onShotQueueClear,
}: {
  ref?: Ref<AnswerSessionHandle>;
  sessions: StoredSession[];
  currentId: string;
  turns: AnswerTurn[];
  resumeName?: string;
  resumeChars: number;
  jdName?: string;
  jdChars: number;
  /** transient parse warning (e.g. scanned PDF with no text layer) */
  notice?: string | null;
  visionReady: boolean;
  /** false = no LLM configured; asking is disabled with an explanation */
  answersReady: boolean;
  answersHint: string;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onPickKb: (slot: KbSlot) => void;
  onClearKb: (slot: KbSlot) => void;
  onCancel: (id: string) => void;
  onClear: () => void;
  onFreeAsk: (question: string) => void;
  onShotAsk: (question: string, imageDataUrl?: string) => void;
  /** R6: screenshots queued for the current session (Ctrl+H/L/R) */
  shotQueue: ShotQueueItem[];
  onShotQueueRemove: (id: string) => void;
  onShotQueueClear: () => void;
}) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const currentName = sessions.find((s) => s.id === currentId)?.name ?? '';

  useEffect(() => {
    if (stick.current && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  });

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  const submit = () => {
    const q = inputRef.current?.value.trim();
    // !answersReady: the 问 button is disabled, so the hotkey does nothing either
    if (!q || !answersReady) return;
    onFreeAsk(q);
    if (inputRef.current) inputRef.current.value = '';
  };
  useImperativeHandle(ref, () => ({ submit }));

  return (
    <section className="pane pane-answer">
      <header className="pane-head session-bar">
        {editing ? (
          <input
            className="session-select"
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              onRename(currentId, nameDraft);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onRename(currentId, nameDraft);
                setEditing(false);
              } else if (e.key === 'Escape') {
                setEditing(false);
              }
            }}
          />
        ) : (
          <select
            className="session-select"
            value={currentId}
            onChange={(e) => onSwitch(e.target.value)}
            title={t.answer.switchTitle}
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <button
          className="btn btn-sm session-rename"
          onClick={() => {
            setNameDraft(currentName);
            setEditing(true);
          }}
          title={t.answer.renameTitle}
        >
          ✎
        </button>
        <div className="session-crud">
          <button className="btn btn-sm" onClick={onNew} title={t.answer.newTitle}>
            ＋
          </button>
          <button className="btn btn-sm" onClick={() => onDelete(currentId)} title={t.answer.deleteTitle}>
            🗑
          </button>
        </div>
        <div className="session-kb-tags">
          <button
            className={resumeChars > 0 ? 'btn btn-sm btn-on' : 'btn btn-sm'}
            onClick={() => onPickKb('resume')}
            title={
              resumeChars > 0
                ? t.answer.resumeSetTitle(resumeName ?? '', resumeChars)
                : t.answer.resumeEmptyTitle
            }
          >
            📄{resumeChars > 0 ? resumeName ?? t.answer.resume : t.answer.resume}
          </button>
          {resumeChars > 0 && (
            <button className="btn btn-sm" onClick={() => onClearKb('resume')} title={t.answer.resumeRemoveTitle}>
              ×
            </button>
          )}
          <button
            className={jdChars > 0 ? 'btn btn-sm btn-on' : 'btn btn-sm'}
            onClick={() => onPickKb('jd')}
            title={jdChars > 0 ? t.answer.jdSetTitle(jdName ?? '', jdChars) : t.answer.jdEmptyTitle}
          >
            📋{jdChars > 0 ? jdName ?? t.answer.jd : t.answer.jd}
          </button>
          {jdChars > 0 && (
            <button className="btn btn-sm" onClick={() => onClearKb('jd')} title={t.answer.jdRemoveTitle}>
              ×
            </button>
          )}
        </div>
        <span className="session-spacer" />
        <button className="btn btn-sm session-clear" onClick={onClear} title={t.answer.clearTitle}>
          {t.answer.clear}
        </button>
      </header>
      {notice && <div className="kb-notice">{notice}</div>}
      <div className="session" ref={boxRef} onScroll={onScroll}>
        {turns.length === 0 ? (
          <div className="pane-empty">
            {t.answer.empty}
            {resumeChars === 0 && t.answer.emptyKbHint}
          </div>
        ) : (
          turns.map((turn) => (
            <div key={turn.id} className={`turn turn-${turn.kind}`}>
              <div className="turn-head">
                <span className="turn-tag">{t.answer.kindTag[turn.kind]}</span>
                <span className="turn-label" title={turn.label}>
                  {turn.label}
                </span>
                {turn.status === 'streaming' ? (
                  <button className="btn btn-sm" onClick={() => onCancel(turn.id)}>
                    {t.answer.stop}
                  </button>
                ) : (
                  <button
                    className="btn btn-sm"
                    onClick={() => void navigator.clipboard.writeText(turn.text)}
                    title={t.answer.copyTitle}
                  >
                    {t.answer.copy}
                  </button>
                )}
              </div>
              <div className="turn-body">
                {turn.status === 'error' ? (
                  <span className="answer-error">{turn.error}</span>
                ) : (
                  <>
                    {turn.text || (turn.kind === 'vision' ? t.answer.visionWaiting : t.answer.genWaiting)}
                    {turn.status === 'streaming' && <span className="cursor">▍</span>}
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      {!answersReady && <div className="kb-notice">{answersHint}</div>}
      {shotQueue.length > 0 && (
        <div className="shot-queue">
          <span className="shot-queue-label">
            {t.answer.queueLabel} · {shotQueue.length}
          </span>
          {shotQueue.map((item, i) => (
            <div
              key={item.id}
              className={`shot-chip shot-chip-${item.status}`}
              title={
                item.status === 'extracting'
                  ? t.answer.queueExtracting
                  : item.status === 'error'
                    ? item.error || t.answer.queueError
                    : item.text || ''
              }
            >
              <img src={item.dataUrl} alt={`S${i + 1}`} />
              {item.status === 'extracting' && <span className="shot-chip-flag shot-chip-spin">…</span>}
              {item.status === 'error' && <span className="shot-chip-flag shot-chip-err">!</span>}
              <button
                className="shot-chip-x"
                onClick={() => onShotQueueRemove(item.id)}
                title={t.answer.queueRemoveTitle}
              >
                ×
              </button>
            </div>
          ))}
          <button className="btn btn-sm" onClick={onShotQueueClear} title={t.answer.queueClearTitle}>
            {t.answer.queueClear}
          </button>
        </div>
      )}
      <div className="answer-input">
        <input
          ref={inputRef}
          disabled={!answersReady}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
          }}
          placeholder={answersReady ? t.answer.freePlaceholder : answersHint}
        />
        <button
          className="btn btn-primary"
          disabled={!answersReady}
          title={answersReady ? undefined : answersHint}
          onClick={submit}
        >
          {t.answer.ask}
        </button>
        {visionReady && (
          <button
            className="btn"
            title={t.answer.shotTitle}
            onClick={async () => {
              const q = inputRef.current?.value.trim() ?? '';
              const img = await window.mc.pickRegion();
              if (!img) return; // cancelled
              if (inputRef.current) inputRef.current.value = '';
              onShotAsk(q, img);
            }}
          >
            📷
          </button>
        )}
      </div>
    </section>
  );
}
