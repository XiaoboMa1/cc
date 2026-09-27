import { useCallback, useEffect, useRef, useState } from 'react';
import type { AsrEvent } from '../../shared/protocol';
import { percentile, type TranscriptSegment } from '../../shared/transcript';

export interface AsrUiState {
  phase: 'loading' | 'ready' | 'error';
  ep?: string;
  gpuSuspect?: boolean;
  workerState: 'loading' | 'listening' | 'speech' | 'transcribing' | 'stopped';
  lastError?: string;
}

export interface HudStats {
  lastE2eMs?: number;
  lastInferMs?: number;
  p50?: number;
  p95?: number;
  count: number;
}

/**
 * ASR events from main: engine state for the status bar, the live partial
 * line per speaker, the latency HUD, and each final segment handed to
 * `onSegment`.
 */
export function useAsrStream(onSegment: (seg: Omit<TranscriptSegment, 'id'>) => void) {
  const [asr, setAsr] = useState<AsrUiState>({ phase: 'loading', workerState: 'loading' });
  const [partials, setPartials] = useState<{ them?: string; me?: string }>({});
  const [hud, setHud] = useState<HudStats>({ count: 0 });
  const partialsRef = useRef(partials);
  partialsRef.current = partials;
  const onSegmentRef = useRef(onSegment);
  onSegmentRef.current = onSegment;
  const e2eSamples = useRef<number[]>([]);

  useEffect(() => {
    const handleAsrEvent = (ev: AsrEvent) => {
      if (ev.kind === 'ready') {
        setAsr((s) => ({ ...s, phase: 'ready', ep: ev.ep, gpuSuspect: ev.gpuSuspect, workerState: 'listening' }));
      } else if (ev.kind === 'status') {
        setAsr((s) => ({ ...s, workerState: ev.state }));
      } else if (ev.kind === 'error') {
        setAsr((s) => ({ ...s, phase: ev.fatal ? 'error' : s.phase, lastError: ev.message }));
      } else if (ev.kind === 'partial') {
        setPartials((p) => ({ ...p, [ev.speaker]: ev.text }));
      } else if (ev.kind === 'segment') {
        setPartials((p) => ({ ...p, [ev.speaker]: undefined })); // final replaces the live partial
        const e2eMs = Date.now() - ev.timings.speechEndTs;
        const inferMs = ev.timings.inferEndTs - ev.timings.inferStartTs;
        const samples = e2eSamples.current;
        samples.push(e2eMs);
        if (samples.length > 200) samples.shift();
        setHud({
          lastE2eMs: e2eMs,
          lastInferMs: inferMs,
          p50: percentile(samples, 50),
          p95: percentile(samples, 95),
          count: samples.length,
        });
        onSegmentRef.current({
          text: ev.text,
          lang: ev.lang,
          speaker: ev.speaker,
          startTs: ev.timings.speechStartTs,
          endTs: ev.timings.speechEndTs,
          e2eMs,
          inferMs,
        });
      }
    };
    const off = window.mc.onAsrEvent(handleAsrEvent);
    // instant-ready cloud engines emit ready/status BEFORE this subscription
    // exists — pull the last ones so the UI never sticks at "模型加载中"
    void window.mc.asrReplay().then(({ ready, status }) => {
      if (ready) handleAsrEvent(ready);
      if (status) handleAsrEvent(status);
    });
    return off;
  }, []);

  /** show a capture / microphone failure in the status bar */
  const reportError = useCallback((message: string) => setAsr((s) => ({ ...s, lastError: message })), []);

  return { asr, partials, partialsRef, hud, reportError };
}
