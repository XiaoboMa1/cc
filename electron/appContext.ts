/**
 * The state every main-process module shares. main.ts builds one object at
 * app ready and passes it to each register*() function; handlers read its
 * fields at call time, so a window created or closed later is seen by all.
 */
import type { BrowserWindow } from 'electron';
import type { UiLang } from '../shared/protocol';
import type { AsrHost } from './asrHost';
import type { FunasrSidecar } from './funasrSidecar';
import type { KnowledgeStore } from './knowledge';
import type { SessionStore } from './sessions';
import type { SettingsStore } from './settings';
import type { AppTray } from './tray';
import { mainStrings } from './uiStrings';

export interface AppContext {
  settings: SettingsStore;
  knowledge: KnowledgeStore;
  sessionStore: SessionStore;
  asr: AsrHost;
  sidecar: FunasrSidecar;
  tray: AppTray;
  /** OS language; the UI language for users who never chose one */
  osLang: UiLang;
  /** the overlay; null until the first-run wizard completes */
  win: BrowserWindow | null;
  /** first-run wizard window; mutually exclusive with `win` until completion */
  setupWin: BrowserWindow | null;
  /** set by before-quit so window handlers stop prompting mid-shutdown */
  quitting: boolean;
  /** an ASR-affecting settings patch arrived while the wizard owned the flow */
  pendingAsrRestart: boolean;
  /** renderer capture lifecycle; the tray menu, the prewarm and the
   * diagnostics report read it */
  capture: { active: boolean; lastStartedAt?: string; lastStoppedAt?: string };
}

/** main-process strings in the current UI language */
export function T(ctx: AppContext) {
  return mainStrings(ctx.settings.data.ui.lang, ctx.osLang);
}
