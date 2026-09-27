/**
 * settings.json schema (SettingsFile), its secret-free renderer view
 * (PublicSettings) and the renderer -> main patch (SettingsPatch), with the
 * hotkey, provider connection-test and first-run wizard types stored in it.
 * Re-exported by shared/protocol.ts.
 */
import type { ProviderCapability, ProviderId } from './providerCatalog';

export type AsrLanguage = 'auto' | 'chinese' | 'english';
/** answer-body font size (right pane only) */
export type FontScale = 'small' | 'medium' | 'large';
/** UI theme; 'system' follows prefers-color-scheme */
export type ThemeMode = 'dark' | 'light' | 'system';
/** UI display language (answers are always English) */
export type UiLang = 'zh' | 'en';

/**
 * Global hotkeys: Electron accelerators, '' = off. electron/mainWindow.ts
 * registerHotkeys registers them system-wide, so while the app runs these
 * combinations never reach another app (browser, code editor).
 */
export interface HotkeySettings {
  /** show/hide the overlay */
  hotkeyToggle: string;
  /** region-capture a screenshot INTO the visual-context queue (R6) — no
   * immediate ask; the manual 📷 button still asks at once */
  hotkeyShot: string;
  /** drop the most recently queued screenshot */
  hotkeyShotUndo: string;
  /** empty the whole queued-screenshot visual context */
  hotkeyShotClear: string;
  /** answer now: interviewer lines since the last answer + queued screenshots */
  hotkeyAnswer: string;
  /** send the question typed in the answer pane (same as the 问 button) */
  hotkeyFreeAsk: string;
  /** start / stop system-audio capture (same as the 开始/停止 button) */
  hotkeyCapture: string;
  /** clear this session's answers (right pane 清空) */
  hotkeyClearAnswers: string;
  /** clear this session's transcript (left pane 清空) */
  hotkeyClearTranscript: string;
  /** a modifier, not a full accelerator: modifier+Up/Down/Left/Right moves the overlay */
  hotkeyMove: string;
}

export const HOTKEY_FIELDS = [
  'hotkeyToggle',
  'hotkeyShot',
  'hotkeyShotUndo',
  'hotkeyShotClear',
  'hotkeyAnswer',
  'hotkeyFreeAsk',
  'hotkeyCapture',
  'hotkeyClearAnswers',
  'hotkeyClearTranscript',
  'hotkeyMove',
] as const satisfies readonly (keyof HotkeySettings)[];

/** hotkeys whose action lives in the renderer; main runs window.__mcHotkey(action) */
export type HotkeyAction =
  | 'shot'
  | 'shotUndo'
  | 'shotClear'
  | 'answer'
  | 'freeAsk'
  | 'capture'
  | 'clearAnswers'
  | 'clearTranscript';

/** outcome of a provider connection test (Phase 3 runs them; the settings
 * schema stores the last result so the UI can show it after a restart) */
export type ProviderTestCode =
  | 'OK'
  | 'INVALID_KEY'
  | 'PERMISSION_DENIED'
  | 'INSUFFICIENT_BALANCE'
  | 'RATE_LIMITED'
  | 'MODEL_NOT_FOUND'
  | 'REGION_MISMATCH'
  | 'NETWORK_UNREACHABLE'
  | 'DNS_ERROR'
  | 'TLS_ERROR'
  | 'PROXY_ERROR'
  | 'TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'UNKNOWN_ERROR';

/** last connection-test result for one provider slot */
export interface ProviderVerification {
  /** ISO-8601 */
  lastTestAt?: string;
  lastTestOk?: boolean;
  lastTestCode?: ProviderTestCode;
  latencyMs?: number;
}

/**
 * Which stored credential/verification slot a test belongs to. Mirrors the
 * settings layout: `asr.cloud` and `asr.realtime` are separate slots so
 * switching backends never clobbers the other one's key or test result.
 */
export type ProviderSlot = 'llm' | 'vision' | 'asr-cloud' | 'asr-realtime';

/**
 * renderer -> main: run ONE connection test. Explicit user action only — the
 * app never tests on startup, and every test costs the user a (minimal) API
 * call: 1 token, ~1.4 s of audio, or a 64x64 image.
 */
export interface ProviderTestRequest {
  /** catalog preset the user picked, when the choice came from the catalog */
  presetId?: string;
  capability: ProviderCapability;
  providerId: ProviderId;
  baseUrl: string;
  model: string;
  /**
   * Plaintext key to test BEFORE it is saved. renderer -> main only: it is
   * never persisted by this call, never logged, and never echoed back.
   */
  candidateApiKey?: string;
  /** test the key already stored in `slot` instead of supplying one */
  useStoredKey?: boolean;
  /** where to read the stored key from and where to record the verdict */
  slot?: ProviderSlot;
  /** vision only: '127.0.0.1:7897'-style local proxy */
  proxyUrl?: string;
  /**
   * ASR only: which bundled test clip to send and which language hint to pass.
   * Absent = main fills it in from `asr.language`.
   */
  language?: AsrLanguage;
}

/**
 * main -> renderer verdict. The messages are built by the unified mapper
 * (electron/providerErrors.ts), so the renderer never has to interpret a raw
 * provider error — which is also what keeps keys and Authorization headers out
 * of the UI.
 */
export interface ProviderTestResult {
  ok: boolean;
  code: ProviderTestCode;
  /** round-trip of the test call itself, present on success and on failure */
  latencyMs?: number;
  messageZh: string;
  messageEn: string;
  /** for the collapsible advanced detail, when the provider volunteered one */
  providerRequestId?: string;
  retryable: boolean;
}

/** the plan the user picked in the first-run wizard */
export type OnboardingPlan = 'recommended' | 'mimo-simple' | 'transcription-only' | 'advanced';

/** first-run wizard state (settings v2) */
export interface OnboardingState {
  /** wizard-state schema, independent of the settings-file version */
  schemaVersion: 1;
  /** false = the setup window owns startup; the main window never opens */
  completed: boolean;
  /** ISO-8601 timestamp of completion */
  completedAt?: string;
  /** 1-based step the user got to (for 保存并稍后继续) */
  lastStep?: number;
  selectedPlan?: OnboardingPlan;
  /** grandfathered users dismissed the "there is a wizard now" notice */
  dismissedUpgradePrompt?: boolean;
  /** set once by the v1 -> v2 migration: this profile was configured by hand
   * before the wizard existed, so the main window offers the upgrade notice.
   * A fresh profile that completed the wizard never carries it. */
  migratedFromV1?: boolean;
}

/** renderer -> main partial onboarding update (never touches `completed`) */
export interface OnboardingProgressPatch {
  lastStep?: number;
  selectedPlan?: OnboardingPlan;
  dismissedUpgradePrompt?: boolean;
}

/** wizard -> main: finish onboarding and hand over to the main window */
export interface OnboardingCompletePayload {
  selectedPlan?: OnboardingPlan;
}

export interface SettingsFile {
  version: 2;
  /** first-run wizard state; added in v2 (migrated files are grandfathered) */
  onboarding: OnboardingState;
  llm: {
    baseUrl: string;
    model: string;
    /** answer with the vision/multimodal provider instead of the text model */
    answerWithVision?: boolean;
    /** encrypted-at-rest (safeStorage, base64); never exposed raw to renderer */
    apiKeyEnc?: string;
    /** catalog provider behind baseUrl+model; 'custom' when unmatched */
    providerId?: ProviderId;
    /** last <=4 characters of the saved key, computed main-side at save time */
    apiKeyHint?: string;
    verification?: ProviderVerification;
  };
  vision: {
    baseUrl?: string;
    model?: string;
    apiKeyEnc?: string;
    /** proxy for blocked providers (e.g. Gemini): '127.0.0.1:7897'; empty = direct */
    proxyUrl?: string;
    providerId?: ProviderId;
    apiKeyHint?: string;
    verification?: ProviderVerification;
  };
  asr: {
    language: AsrLanguage;
    /** override models dir; default %APPDATA%/MeetingCopilot/models */
    modelsDir?: string;
    /** catalog provider behind the ACTIVE cloud slot; absent for local backends */
    providerId?: ProviderId;
    /** 'local-realtime' = auto-spawned local sidecar (FunASR or MOSS);
     * 'local' = whisper turbo on-device; 'cloud' = OpenAI-compatible ASR API;
     * 'cloud-realtime' = remote WebSocket streaming (e.g. Aliyun fun-asr-realtime) */
    backend?: 'local' | 'cloud' | 'cloud-realtime' | 'local-realtime';
    /** cloud ASR provider (used when backend === 'cloud') */
    cloud?: {
      baseUrl?: string;
      model?: string;
      apiKeyEnc?: string;
      apiKeyHint?: string;
      verification?: ProviderVerification;
    };
    /** streaming cloud ASR provider (used when backend === 'cloud-realtime');
     * separate slot so switching backends never clobbers the other's config */
    realtime?: {
      /** wss:// endpoint, e.g. wss://{ws}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference */
      baseUrl?: string;
      model?: string;
      apiKeyEnc?: string;
      apiKeyHint?: string;
      verification?: ProviderVerification;
    };
    /** local sidecar (backend === 'local-realtime'); fixed localhost endpoint,
     * model is FunASR Nano, paraformer streaming, or experimental MOSS */
    localRealtime?: {
      model?: string;
    };
  };
  ui: HotkeySettings & {
    stealth: boolean;
    opacity: number;
    /** answer-body font size (small=13px / medium=16px / large=19px) */
    fontScale: FontScale;
    theme: ThemeMode;
    /** UI display language; absent = follow OS locale (zh → zh, else en) */
    lang?: UiLang;
    /** start MeetingCopilot with the OS session; DEFAULT OFF, user opt-in only */
    autoLaunch?: boolean;
    /** the "still running in the tray" balloon was shown once; never repeated */
    trayNoticeShown?: boolean;
  };
  audio: {
    /** input used for the other-party channel on platforms without loopback */
    themDeviceId?: string;
    /** also capture the microphone (dual-channel transcription: 对方 + 我) */
    micEnabled: boolean;
    /** chosen mic device id ('' / undefined = system default) */
    micDeviceId?: string;
  };
}

/** What the renderer is allowed to see (no secrets). */
export interface PublicSettings {
  version: 2;
  /**
   * true when the OS credential store is unavailable and API keys can only be
   * obfuscated (the plainCipher fallback). NOT persisted — it describes the
   * running machine, and both `settings:get` and `settings:set` report it so
   * the UI can warn BEFORE a key is sent for saving.
   */
  weakCrypto: boolean;
  /** first-run wizard state — public so the UI can show the upgrade notice */
  onboarding: OnboardingState;
  llm: {
    baseUrl: string;
    model: string;
    answerWithVision: boolean;
    apiKeySet: boolean;
    providerId?: ProviderId;
    /** last <=4 characters of the saved key — never the key itself */
    apiKeyHint?: string;
    verification?: ProviderVerification;
  };
  vision: {
    baseUrl?: string;
    model?: string;
    proxyUrl?: string;
    apiKeySet: boolean;
    providerId?: ProviderId;
    apiKeyHint?: string;
    verification?: ProviderVerification;
  };
  /** personal knowledge base (resume/notes) loaded from an .md file */
  knowledge: { chars: number };
  asr: {
    language: AsrLanguage;
    modelsDir?: string;
    backend: 'local' | 'cloud' | 'cloud-realtime' | 'local-realtime';
    providerId?: ProviderId;
    cloud: {
      baseUrl?: string;
      model?: string;
      apiKeySet: boolean;
      apiKeyHint?: string;
      verification?: ProviderVerification;
    };
    realtime: {
      baseUrl?: string;
      model?: string;
      apiKeySet: boolean;
      apiKeyHint?: string;
      verification?: ProviderVerification;
    };
    localRealtime: { model?: string };
  };
  ui: HotkeySettings & {
    stealth: boolean;
    opacity: number;
    fontScale: FontScale;
    theme: ThemeMode;
    lang: UiLang;
    autoLaunch: boolean;
    trayNoticeShown: boolean;
  };
  audio: { themDeviceId?: string; micEnabled: boolean; micDeviceId?: string };
}

/**
 * Renderer -> main settings update. Plaintext apiKey in transit only.
 * `apiKeyHint` is deliberately absent: it is derived main-side when a key is
 * saved, so the renderer can never desync (or spoof) it.
 */
export interface SettingsPatch {
  llm?: {
    baseUrl?: string;
    model?: string;
    answerWithVision?: boolean;
    apiKey?: string;
    providerId?: ProviderId;
    verification?: ProviderVerification;
  };
  vision?: {
    baseUrl?: string;
    model?: string;
    proxyUrl?: string;
    apiKey?: string;
    providerId?: ProviderId;
    verification?: ProviderVerification;
  };
  asr?: {
    language?: AsrLanguage;
    backend?: 'local' | 'cloud' | 'cloud-realtime' | 'local-realtime';
    providerId?: ProviderId;
    cloud?: {
      baseUrl?: string;
      model?: string;
      apiKey?: string;
      verification?: ProviderVerification;
    };
    realtime?: {
      baseUrl?: string;
      model?: string;
      apiKey?: string;
      verification?: ProviderVerification;
    };
    localRealtime?: { model?: string };
  };
  ui?: Partial<HotkeySettings> & {
    stealth?: boolean;
    opacity?: number;
    fontScale?: FontScale;
    theme?: ThemeMode;
    lang?: UiLang;
    autoLaunch?: boolean;
    trayNoticeShown?: boolean;
  };
  audio?: { themDeviceId?: string; micEnabled?: boolean; micDeviceId?: string };
}
