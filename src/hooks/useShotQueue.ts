import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { ShotQueueItem } from '../components/AnswerSession';
import { uid } from './useSessions';

export type ShotQueueApi = ReturnType<typeof useShotQueue>;

/**
 * R6: per-session queued screenshots (Ctrl+H capture / Ctrl+L undo / Ctrl+R
 * clear) whose extracted text (E) rides along with the next answers as visual
 * context — distinct from askShot, which asks about one screenshot at once.
 * In memory only, never persisted with the session (images can't outlast the
 * running app).
 */
export function useShotQueue(currentIdRef: RefObject<string>) {
  const [shotQueues, setShotQueues] = useState<Record<string, ShotQueueItem[]>>({});
  const shotQueuesRef = useRef(shotQueues);
  shotQueuesRef.current = shotQueues;

  useEffect(
    () =>
      window.mc.onShotExtractEvent((ev) => {
        setShotQueues((q) => {
          const next: Record<string, ShotQueueItem[]> = {};
          for (const [sid, list] of Object.entries(q)) {
            next[sid] = list.map((item) => {
              if (item.id !== ev.requestId) return item;
              if (ev.kind === 'done') return { ...item, status: 'ready', text: ev.text };
              if (ev.kind === 'error') return { ...item, status: 'error', error: ev.message };
              return item; // 'delta': extraction never streams
            });
          }
          return next;
        });
      }),
    [],
  );

  const removeShotQueueItem = useCallback((sid: string, id: string) => {
    const item = shotQueuesRef.current[sid]?.find((it) => it.id === id);
    if (item?.status === 'extracting') window.mc.llmCancel(id);
    setShotQueues((q) => ({ ...q, [sid]: (q[sid] ?? []).filter((it) => it.id !== id) }));
  }, []);

  // Esc during the drag resolves pickRegion() with null BEFORE any of this
  // runs, so a cancelled capture never reaches the queue or gets extracted.
  const captureShot = useCallback(async () => {
    const img = await window.mc.pickRegion();
    if (!img) return; // Esc / too-small drag — cancelled, nothing to queue
    const sid = currentIdRef.current;
    if (!sid) return;
    const id = uid('shot');
    setShotQueues((q) => ({
      ...q,
      [sid]: [...(q[sid] ?? []), { id, dataUrl: img, status: 'extracting', at: Date.now() }],
    }));
    window.mc.shotExtract({ requestId: id, imageDataUrl: img });
  }, [currentIdRef]);

  const undoLastShot = useCallback(() => {
    const sid = currentIdRef.current;
    const last = shotQueuesRef.current[sid]?.at(-1);
    if (last) removeShotQueueItem(sid, last.id);
  }, [currentIdRef, removeShotQueueItem]);

  /** empty one session's queue (default: the current one), cancelling any
   * extraction still running */
  const clearShotQueue = useCallback(
    (sid?: string) => {
      const id = sid ?? currentIdRef.current;
      for (const item of shotQueuesRef.current[id] ?? []) {
        if (item.status === 'extracting') window.mc.llmCancel(item.id);
      }
      setShotQueues((q) => ({ ...q, [id]: [] }));
    },
    [currentIdRef],
  );

  return { shotQueues, shotQueuesRef, captureShot, undoLastShot, clearShotQueue, removeShotQueueItem };
}
