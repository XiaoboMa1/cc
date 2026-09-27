/**
 * Model requests from the renderer: answers (ai-ans), screenshot Q&A and
 * extraction (ai-ext), the rolling memo, translation, and the provider
 * prefix-cache prewarm. API keys stay in this process; the renderer only
 * sends requests and receives LlmEvents.
 */
import { app, desktopCapturer, ipcMain } from 'electron';
import { appendFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import {
  IPC,
  type LlmAskPayload,
  type LlmEvent,
  type MemoUpdatePayload,
  type PrewarmPayload,
  type ShotAskPayload,
  type ShotExtractPayload,
} from '../shared/protocol';
import { T, type AppContext } from './appContext';
import { chatOnce, chatStream } from './llm/adapter';
import {
  buildAnswerMessages,
  buildExtractionMessages,
  buildMemoUpdateMessages,
  buildPrewarmMessages,
  buildStablePrefix,
  buildTranslateMessages,
  buildVisionMessages,
  clampMemo,
  type AnswerPromptInput,
} from './llm/prompts';
import { visionChat } from './llm/vision';
import {
  diffTranscriptForLog,
  formatPromptLogError,
  formatPromptLogRequest,
  formatPromptLogResponse,
} from './promptLog';

// Debug-only prompt/response log — OFF unless enabled. Local disk only (see
// electron/promptLog.ts for why this is kept separate from diagnostics.ts's
// upload-safe report). Two ways to turn it on:
//   - `--debug-log` on the launch command (start.bat --debug-log, or
//     `npm run start:debug-log` / `npm run dev:debug-log`) — auto-creates
//     debug-log/<month>-<day>-<hour><minute>.log under the project root.
//   - MC_PROMPT_LOG=<exact path> — explicit override, takes precedence.
const pad2 = (n: number) => String(n).padStart(2, '0');
const launchedAt = new Date();
export const PROMPT_LOG_PATH =
  process.env.MC_PROMPT_LOG ??
  (process.env.MC_DEBUG_LOG || process.argv.includes('--debug-log')
    ? join(
        app.getAppPath(),
        'debug-log',
        `${pad2(launchedAt.getMonth() + 1)}-${pad2(launchedAt.getDate())}-${pad2(launchedAt.getHours())}${pad2(launchedAt.getMinutes())}.log`,
      )
    : undefined);

function appendPromptLog(text: string): void {
  if (!PROMPT_LOG_PATH) return;
  try {
    mkdirSync(dirname(PROMPT_LOG_PATH), { recursive: true });
    appendFileSync(PROMPT_LOG_PATH, text, 'utf8');
  } catch (e) {
    console.error('[prompt-log] write failed:', (e as Error).message);
  }
}

/** a prefix unused this long has left the provider-side cache */
const PREWARM_IDLE_MS = 4 * 60_000;

/** @returns keepWarm(on), which main.ts calls on capture start / stop */
export function registerLlmIpc(ctx: AppContext): { keepWarm(on: boolean): void } {
  const { settings } = ctx;

  /** Resume material for the system prompt: the session's resume (or legacy
   * background) first; the global knowledge base only fills in when the
   * session has neither resume nor JD. Prewarm and real answers both use
   * this, so the prewarmed prefix is byte-identical to the real one. */
  const resumeFor = (p: { resume?: string; jd?: string; background?: string }): string =>
    p.resume || p.background || (p.jd ? '' : ctx.knowledge.text);

  // ---- P1-6: DeepSeek prefix-cache prewarm + keep-warm while capturing ----
  // One max_tokens=1 request with the byte-identical stable prefix builds the
  // provider-side KV cache, so the first real answer prefills at 0.1x price
  // and lower latency. Re-ping when the cache would go cold (same pattern as
  // the ASR 45s keep-warm). Real answer requests refresh the cache themselves.
  let lastPrefix: string | null = null;
  let lastPrefixActivity = 0; // last time the answer prefix hit the provider
  let keepWarmTimer: NodeJS.Timeout | null = null;

  async function doPrewarm(prefix: string, reason: string): Promise<void> {
    const llm = settings.getLlmEndpoint();
    if (!llm || settings.data.llm.answerWithVision) return; // vision path ≠ DeepSeek
    lastPrefix = prefix;
    lastPrefixActivity = Date.now();
    try {
      const r = await chatOnce(llm, buildPrewarmMessages(prefix), { maxTokens: 1 });
      console.log(
        `[prewarm] ${reason}: cache_hit=${r.usage?.prompt_cache_hit_tokens ?? '?'} cache_miss=${r.usage?.prompt_cache_miss_tokens ?? '?'} prompt=${r.usage?.prompt_tokens ?? '?'}`,
      );
    } catch (e) {
      console.warn('[prewarm] failed:', (e as Error).message);
    }
  }

  ipcMain.on(IPC.llmPrewarm, (_e, p: PrewarmPayload = {}) => {
    const prefix = buildStablePrefix(p.interviewType ?? 'tech', resumeFor(p), p.jd ?? '');
    const dirty = prefix !== lastPrefix;
    const cold = Date.now() - lastPrefixActivity >= PREWARM_IDLE_MS;
    if (!dirty && !cold) return;
    if (p.immediate || ctx.capture.active) {
      void doPrewarm(prefix, dirty ? 'dirty' : 'refresh');
    } else {
      lastPrefix = null; // mark stale; the next ▶ prewarm sees dirty and reheats
    }
  });

  // ---- cancellable requests: llmCancel(requestId) aborts any of them ----
  const controllers = new Map<string, AbortController>();

  /** Run one model request under an AbortController registered for
   * llmCancel. Resolves with the text; resolves null on a user cancel, and
   * on a failure after logging it and sending an 'error' event. */
  async function cancellable(
    requestId: string,
    tag: string,
    send: (ev: LlmEvent) => void,
    work: (signal: AbortSignal) => Promise<string>,
  ): Promise<string | null> {
    const ac = new AbortController();
    controllers.set(requestId, ac);
    try {
      return await work(ac.signal);
    } catch (e) {
      if (ac.signal.aborted) return null; // user cancelled — not an error
      const message = (e as Error).message;
      console.error(`[${tag}] request failed:`, message);
      send({ requestId, kind: 'error', message });
      return null;
    } finally {
      controllers.delete(requestId);
    }
  }

  ipcMain.on(IPC.llmCancel, (_e, requestId: string) => {
    controllers.get(requestId)?.abort();
    controllers.delete(requestId);
  });

  // ---- LLM (R4): streaming answers ----
  ipcMain.on(IPC.llmAsk, (_e, payload: LlmAskPayload) => {
    const { requestId, mode } = payload;
    const send = (ev: LlmEvent) => ctx.win?.webContents.send(IPC.llmEvent, ev);
    const llm = settings.getLlmEndpoint();
    if (!llm) {
      send({ requestId, kind: 'error', message: T(ctx).noApiKey });
      return;
    }
    const isTranslate = mode === 'translate';
    const promptInput: AnswerPromptInput = {
      mode,
      question: payload.question,
      freeQuestion: payload.freeQuestion,
      transcript: payload.transcript ?? [],
      interviewType: payload.interviewType,
      earlierAnswers: payload.earlierAnswers,
      chatHistory: payload.chatHistory,
      // translate stays a clean pass-through: no material, memo or screenshots
      ...(isTranslate
        ? {}
        : { resume: resumeFor(payload), jd: payload.jd, memo: payload.memo, visualContext: payload.visualContext }),
    };
    const messages = buildAnswerMessages(promptInput);

    if (PROMPT_LOG_PATH) {
      const sid = payload.sessionId ?? 'unknown-session';
      const { newLines, carriedOverCount } = diffTranscriptForLog(sid, promptInput.transcript);
      // same builder as the real call, transcript window swapped for only
      // the not-yet-logged lines — guarantees the logged shape can never
      // drift from what buildAnswerMessages actually produces
      appendPromptLog(
        formatPromptLogRequest({
          at: new Date().toISOString(),
          sessionId: sid,
          requestId,
          mode,
          messages: buildAnswerMessages({ ...promptInput, transcript: newLines }),
          newLineCount: newLines.length,
          carriedOverCount,
        }),
      );
    }

    // "answer with multimodal": route through the vision provider (proxy-aware,
    // non-streaming). Otherwise stream from the text LLM (direct, fastest).
    const vision = settings.data.llm.answerWithVision && !isTranslate ? settings.getVisionEndpoint() : null;

    // a real answer request refreshes the provider-side prefix cache itself
    if (!isTranslate && !vision && mode !== 'free') {
      lastPrefix = buildStablePrefix(payload.interviewType ?? 'tech', resumeFor(payload), payload.jd ?? '');
      lastPrefixActivity = Date.now();
    }

    void cancellable(requestId, 'llm', send, async (signal) => {
      try {
        if (vision) {
          const text = await visionChat(vision, messages, signal);
          send({ requestId, kind: 'delta', text });
          return text;
        }
        const r = await chatStream(
          llm,
          messages,
          { onDelta: (text) => send({ requestId, kind: 'delta', text }) },
          signal,
        );
        if (r.usage) {
          // prewarm acceptance signal: after a warm, hit ≈ prefix length
          console.log(
            `[llm] done mode=${mode} cache_hit=${r.usage.prompt_cache_hit_tokens ?? '?'} cache_miss=${r.usage.prompt_cache_miss_tokens ?? '?'}`,
          );
        }
        return r.text;
      } catch (e) {
        if (!signal.aborted) appendPromptLog(formatPromptLogError(requestId, (e as Error).message));
        throw e;
      }
    }).then((text) => {
      if (text === null) return;
      send({ requestId, kind: 'done', text });
      appendPromptLog(formatPromptLogResponse(requestId, text));
    });
  });

  // P1-5: fold a finished Q&A into the rolling interview memo. Async and
  // off the critical answer path — renderer serializes calls per session.
  ipcMain.handle(IPC.memoUpdate, async (_e, p: MemoUpdatePayload): Promise<string> => {
    const llm = settings.getLlmEndpoint();
    if (!llm) return '';
    try {
      const r = await chatOnce(llm, buildMemoUpdateMessages(p.memo ?? '', p.question ?? '', p.answer ?? ''), {
        maxTokens: 700,
        temperature: 0.2,
      });
      return clampMemo(r.text);
    } catch (e) {
      console.warn('[memo] update failed:', (e as Error).message);
      return '';
    }
  });

  // Cheap one-shot translation to Chinese (inline transcript 对照; off-session,
  // no history pollution). Uses the fast text model (deepseek-chat).
  ipcMain.handle(IPC.translateText, async (_e, text: string) => {
    const llm = settings.getLlmEndpoint();
    if (!llm) throw new Error(T(ctx).noApiKeyShort);
    const r = await chatStream(llm, buildTranslateMessages(text), { onDelta: () => {} });
    return r.text;
  });

  // ---- R5: screenshot -> vision model. Our own window is excluded from
  // the capture automatically (content protection). ----
  ipcMain.on(IPC.shotAsk, (_e, payload: ShotAskPayload) => {
    const { requestId } = payload;
    const send = (ev: LlmEvent) => ctx.win?.webContents.send(IPC.llmEvent, ev);
    const vision = settings.getVisionEndpoint();
    if (!vision) {
      send({ requestId, kind: 'error', message: T(ctx).noVision });
      return;
    }
    void cancellable(requestId, 'vision', send, async (signal) => {
      // region mode provides a pre-cropped image; else capture the full screen
      const dataUrl =
        payload.imageDataUrl ||
        (
          await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1600, height: 900 } })
        )[0].thumbnail.toDataURL();
      return visionChat(
        vision,
        buildVisionMessages(payload.question, dataUrl, payload.background || ctx.knowledge.text),
        signal,
      );
    }).then((text) => {
      if (text === null) return;
      send({ requestId, kind: 'delta', text });
      send({ requestId, kind: 'done', text });
    });
  });

  // ---- R6: screenshot -> extracted text (ai-ext), queued visual context.
  // requestId is the queue item's own id, so a removed-mid-extraction item
  // aborts cleanly through the SAME llmCancel path as any other request. ----
  ipcMain.on(IPC.shotExtract, (_e, payload: ShotExtractPayload) => {
    const { requestId } = payload;
    const send = (ev: LlmEvent) => ctx.win?.webContents.send(IPC.shotExtractEvent, ev);
    const vision = settings.getVisionEndpoint();
    if (!vision) {
      send({ requestId, kind: 'error', message: T(ctx).noVision });
      return;
    }
    void cancellable(requestId, 'shot-extract', send, (signal) =>
      visionChat(vision, buildExtractionMessages(payload.imageDataUrl), signal),
    ).then((text) => {
      if (text !== null) send({ requestId, kind: 'done', text });
    });
  });

  return {
    keepWarm(on: boolean): void {
      if (!on) {
        if (keepWarmTimer) clearInterval(keepWarmTimer);
        keepWarmTimer = null;
        return;
      }
      keepWarmTimer ??= setInterval(() => {
        if (!ctx.capture.active || !lastPrefix) return;
        if (Date.now() - lastPrefixActivity >= PREWARM_IDLE_MS) void doPrewarm(lastPrefix, 'keep-warm');
      }, 60_000);
    },
  };
}
