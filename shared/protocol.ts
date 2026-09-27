/**
 * SDD contract: IPC protocol between main <-> renderer. The settings schema
 * (shared/settingsSchema.ts) is re-exported here, so every caller imports
 * both from this one module. Version this file; breaking changes bump
 * PROTOCOL_VERSION.
 */
import type { TrayRendererCommand } from './trayMenu';

export const PROTOCOL_VERSION = 1;

export type { ProviderCapability, ProviderId } from './providerCatalog';
export type { TrayCommand, TrayRendererCommand } from './trayMenu';
export * from './settingsSchema';

// ---------- Transcript and session primitives ----------

/** who is speaking: the other party (system audio) vs the user (microphone) */
export type Speaker = 'them' | 'me';
/** one transcript segment as the prompt builder and the debug log see it */
export interface TranscriptLine {
  id: number;
  speaker: Speaker;
  text: string;
}
/** one earlier answer turn as a prompt carries it: the question it answered
 * ('' when it answered from the screenshots alone) and the answer text */
export interface QaPair {
  question: string;
  answer: string;
}
/** per session: which system prompt ai-ans uses (electron/llm/prompts.ts
 * PROMPT_HR — behavioral / motivation / CV deep dive; PROMPT_TECH — coding /
 * system design / concept explanation) */
export type InterviewType = 'hr' | 'tech';
/** per-session material slots: resume vs job description */
export type KbSlot = 'resume' | 'jd';

/** identity of the running build (shown in the wizard footer / about) */
export interface AppInfo {
  version: string;
  platform: NodeJS.Platform;
  /** false in `npm run dev`, true inside an installed build */
  packaged: boolean;
}

// ---------- ASR events (main -> renderer) ----------

export interface SegmentTimings {
  /** Date.now() of the first speech sample of the segment */
  speechStartTs: number;
  /** Date.now() of the last audio sample of the segment (speech end) */
  speechEndTs: number;
  /** when VAD closed the segment (speechEndTs + hangover) */
  vadCloseTs: number;
  inferStartTs: number;
  inferEndTs: number;
}

export interface AsrSegmentEvent {
  kind: 'segment';
  id: number;
  text: string;
  lang?: string;
  speaker: Speaker;
  audioMs: number;
  timings: SegmentTimings;
}

export interface AsrReadyEvent {
  kind: 'ready';
  loadMs: number;
  warmMs: number;
  ep: string;
  gpuSuspect: boolean; // true when warm timing suggests CPU fallback
}

export interface AsrStatusEvent {
  kind: 'status';
  state: 'loading' | 'listening' | 'speech' | 'transcribing' | 'stopped';
  queuedSegments: number;
}

export interface AsrErrorEvent {
  kind: 'error';
  message: string;
  fatal: boolean;
}

/** live streaming partial (transient; replaced by the final segment) */
export interface AsrPartialEvent {
  kind: 'partial';
  speaker: Speaker;
  text: string;
}

export type AsrEvent =
  | AsrSegmentEvent
  | AsrPartialEvent
  | AsrReadyEvent
  | AsrStatusEvent
  | AsrErrorEvent;

// ---------- Sessions (multi-conversation, persisted) ----------

export interface StoredTurn {
  id: string;
  kind: 'segment' | 'continuous' | 'free' | 'translate' | 'vision';
  label: string;
  /** the question sent to the model; '' when there was none (an answer from
   * the screenshots alone). label shows a placeholder in that case */
  question?: string;
  text: string;
  status: 'streaming' | 'done' | 'error';
  error?: string;
}

export interface StoredSession {
  id: string;
  name: string;
  createdAt: number;
  turns: StoredTurn[];
  /** per-session transcript (isolated per meeting, same as the conversation) */
  segments?: import('./transcript').TranscriptSegment[];
  /** true once named (auto from first question, or manually renamed) */
  titled?: boolean;
  /** legacy single-slot KB (pre dual-slot); migrated to the resume slot on load */
  kbName?: string;
  kbText?: string;
  /** dual-slot session material: resume + job description (P0-2) */
  resumeName?: string;
  resumeText?: string;
  jdName?: string;
  jdText?: string;
  /** rolling interview memo (P1): structured summary, async-updated */
  memo?: string;
  /** chosen in the title bar; absent = 'tech' */
  interviewType?: InterviewType;
}

export interface SessionsFile {
  sessions: StoredSession[];
  currentId: string | null;
}

// ---------- LLM (R4): renderer <-> main ----------

export interface LlmAskPayload {
  requestId: string;
  /** which session this ask belongs to (debug prompt-log keys off this) */
  sessionId?: string;
  mode: 'segment' | 'continuous' | 'free' | 'translate';
  /** the sentence to answer (segment) or text to translate (translate) */
  question?: string;
  /** free-form question (mode === 'free') */
  freeQuestion?: string;
  /** recent transcript, oldest first; ids let the debug prompt-log skip lines
   * it already wrote for this session */
  transcript: TranscriptLine[];
  /** selects the ai-ans system prompt (segment/continuous); default 'tech' */
  interviewType?: InterviewType;
  /** earlier 答/持续 turns (oldest first); empty while the mic is on */
  earlierAnswers?: QaPair[];
  /** earlier 问 / 截图 turns (oldest first); mode 'free' only */
  chatHistory?: QaPair[];
  /** legacy single-slot KB (kept for compat; treated as resume material) */
  background?: string;
  /** dual-slot session material (P0-2) */
  resume?: string;
  jd?: string;
  /** rolling interview memo (P1) */
  memo?: string;
  /** R6: extracted text (E) from every screenshot currently queued for this
   * session, oldest first — folded into the prompt as "visual context" */
  visualContext?: string[];
}

export type LlmEvent =
  | { requestId: string; kind: 'delta'; text: string }
  | { requestId: string; kind: 'done'; text: string }
  | { requestId: string; kind: 'error'; message: string };

/** R6: renderer -> main, extract text (E) from ONE queued screenshot (ai-ext).
 * requestId is the queue item's own id (so llmCancel can abort it if the item
 * is removed mid-extraction); the result streams back on shotExtractEvent as
 * a plain 'done' | 'error' LlmEvent (never 'delta' — non-streaming). */
export interface ShotExtractPayload {
  requestId: string;
  imageDataUrl: string;
}

/** R5: renderer -> main, answer a question about a screenshot (vision model).
 * No imageDataUrl = main captures the full screen itself. */
export interface ShotAskPayload {
  requestId: string;
  question: string;
  background?: string;
  imageDataUrl?: string;
}

/** P1-6: renderer -> main, warm the provider prefix cache with this material;
 * immediate=true warms even when not capturing (▶ start / material import) */
export interface PrewarmPayload {
  resume?: string;
  jd?: string;
  interviewType?: InterviewType;
  immediate?: boolean;
}

/** P1-5: renderer -> main, fold one finished Q&A into the rolling memo
 * (main returns '' to keep the old memo) */
export interface MemoUpdatePayload {
  memo: string;
  question: string;
  answer: string;
}

// ---------- System tray (main -> renderer) ----------

/**
 * A tray menu entry the MAIN process cannot service on its own: capture,
 * sessions and every panel live in the renderer. Main always makes the window
 * visible first, so the renderer may assume it is on screen.
 */
export interface TrayCommandPayload {
  command: TrayRendererCommand;
}

// ---------- IPC channel names ----------

export const IPC = {
  /** renderer -> main, fire and forget: (ArrayBuffer pcmF32, captureTs, Speaker) */
  capturePcm: 'capture:pcm',
  /** invoke: (text) => string — cheap one-shot translation to Chinese (inline, off-session) */
  translateText: 'llm:translate',
  /** renderer -> main: capture lifecycle */
  captureStarted: 'capture:started',
  captureStopped: 'capture:stopped',
  /** main -> renderer: AsrEvent */
  asrEvent: 'asr:event',
  /** invoke: () => {ready, status} — pull the last ready/status AsrEvents.
   * Cloud engines are ready in ms, BEFORE React subscribes; push-replay on
   * did-finish-load still races the subscription, so the renderer pulls. */
  asrReplay: 'asr:replay',
  /** invoke: () => PublicSettings */
  settingsGet: 'settings:get',
  /** invoke: (SettingsPatch) => PublicSettings */
  settingsSet: 'settings:set',
  /** invoke: () => {chars:number} — import a .md into the GLOBAL default KB (opens dialog) */
  knowledgeImport: 'knowledge:import',
  /** invoke: () => {chars:number} — clear the global default KB */
  knowledgeClear: 'knowledge:clear',
  /** invoke: (KbSlot) => {name,text,chars} | null — pick a resume/JD document
   * (.md/.txt/.docx/.pdf, parsed deterministically) for the CURRENT session */
  knowledgePick: 'knowledge:pick',
  /** invoke: () => SessionsFile — load persisted sessions */
  sessionsLoad: 'sessions:load',
  /** send: (SessionsFile) — persist sessions (debounced by renderer) */
  sessionsSave: 'sessions:save',
  /** invoke: () => string|null — full-screen capture, drag a region (stealth overlay), returns cropped dataURL */
  regionPick: 'region:pick',
  /** invoke (overlay→main): () => string|null — the captured full-screen image to draw */
  regionImage: 'region:image',
  /** send (overlay→main): (rect) — chosen region */
  regionRect: 'region:rect',
  /** send (overlay→main): () — cancel selection */
  regionCancel: 'region:cancel',
  /** invoke: (boolean) => boolean — toggles content protection live */
  stealthSet: 'stealth:set',
  /** send: hide window */
  winHide: 'win:hide',
  /** send: quit app (clean) */
  appQuit: 'app:quit',
  /** main -> renderer: request auto start capture (dev/E2E) */
  autoStart: 'capture:auto-start',
  /** renderer -> main: start a streaming answer (LlmAskPayload) */
  llmAsk: 'llm:ask',
  /** renderer -> main: screenshot + vision question ({requestId, question}); answer streams on llmEvent */
  shotAsk: 'shot:ask',
  /** renderer -> main: extract text from one queued screenshot (ShotExtractPayload); result on shotExtractEvent */
  shotExtract: 'shot:extract',
  /** main -> renderer: LlmEvent for a shotExtract request ('done' | 'error' only) */
  shotExtractEvent: 'shot:extract:event',
  /** renderer -> main: cancel a running request (requestId) */
  llmCancel: 'llm:cancel',
  /** main -> renderer: LlmEvent stream */
  llmEvent: 'llm:event',
  /** send: ({resume?, jd?}) — warm the DeepSeek KV prefix cache (P1-6):
   * one max_tokens=1 request whose system prompt is byte-identical to real
   * answer requests, so the first real question prefills from cache */
  llmPrewarm: 'llm:prewarm',
  /** invoke: ({memo, question, answer}) => string — async rolling interview
   * memo update (P1-5); cheap off-critical-path deepseek-chat call, '' = keep old */
  memoUpdate: 'llm:memo',
  /** invoke: () => OnboardingState — first-run wizard state */
  onboardingGet: 'onboarding:get',
  /** invoke: (OnboardingProgressPatch) => OnboardingState — 保存并稍后继续 /
   * dismissing the upgrade notice; never flips `completed` */
  onboardingSaveProgress: 'onboarding:save-progress',
  /** invoke: (OnboardingCompletePayload) => OnboardingState — wizard finished:
   * persist completion, close the setup window and hand over to the main app */
  onboardingComplete: 'onboarding:complete',
  /** invoke: () => boolean — main window asks for the wizard again ("重新运行
   * 配置向导" / the upgrade notice). Re-run mode keeps the main window alive
   * and never quits the app when the wizard is closed. */
  onboardingRerun: 'onboarding:rerun',
  /** invoke: (url) => boolean — open an allowlisted https URL in the OS
   * browser; the renderer can never navigate or window.open by itself */
  externalOpen: 'app:open-external',
  /** invoke: () => string — read the clipboard, ONLY from an explicit
   * paste-button click (never polled) */
  clipboardReadText: 'app:clipboard-read',
  /** invoke: () => AppInfo */
  appGetInfo: 'app:get-info',
  /** invoke: (ProviderTestRequest) => ProviderTestResult — run one real
   * connection test against a provider. Explicit user action only: never on
   * startup, never polled, one minimal billable request per call. Main also
   * records the verdict into the slot's `verification` (a dedicated store
   * write that deliberately does NOT go through settings:set, which would
   * restart the ASR engine). */
  providerTest: 'provider:test',
  /** invoke: () => string — plaintext, locally built support report. Contains
   * no keys, no transcripts and no knowledge-base text (electron/diagnostics.ts) */
  diagnosticsGet: 'diagnostics:get',
  /** invoke: () => boolean — reveal the userData folder in Explorer/Finder */
  logsOpenFolder: 'logs:open-folder',
  /** main -> renderer: TrayCommandPayload — a tray menu entry that only the
   * renderer can service (start/stop capture, new session, open a panel).
   * Main shows the window before sending, so the UI is always visible. */
  trayCommand: 'tray:command',
} as const;
