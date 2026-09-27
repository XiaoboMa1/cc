/**
 * MeetingCopilot main process entry: single-instance lock, the shared
 * AppContext, IPC registration and app lifecycle. PLAN.en.md §5.
 * Each feature's code lives in its own module:
 *   mainWindow.ts    overlay window, tray icon, global hotkeys, auto-launch
 *   setupFlow.ts     first-run / re-run wizard window + onboarding IPC
 *   asrControl.ts    ASR worker lifecycle + audio IPC
 *   llmIpc.ts        answers, screenshot Q&A / extraction, memo, translation, prewarm
 *   regionPicker.ts  screenshot region selection overlay
 *   appIpc.ts        settings, provider tests, diagnostics, knowledge, sessions
 *   devHooks.ts      MC_* test / visual-QA hooks on the overlay
 */
import { app, globalShortcut, ipcMain, safeStorage } from 'electron';
import { join } from 'path';
import { IPC } from '../shared/protocol';
import type { AppContext } from './appContext';
import { registerAppIpc } from './appIpc';
import { registerAsrIpc } from './asrControl';
import { AsrHost } from './asrHost';
import { FunasrSidecar } from './funasrSidecar';
import { KnowledgeStore } from './knowledge';
import { registerLlmIpc } from './llmIpc';
import { showWindow, startMainApp } from './mainWindow';
import { registerRegionPicker } from './regionPicker';
import { SessionStore } from './sessions';
import { SettingsStore, plainCipher, type SecretCipher } from './settings';
import { openSetupWindow, registerSetupIpc } from './setupFlow';
import { AppTray } from './tray';

app.setName('MeetingCopilot');

// E2E/demo hook: run against an isolated profile — must precede the
// single-instance lock so a test instance never collides with a real one
if (process.env.MC_USERDATA) app.setPath('userData', process.env.MC_USERDATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void app.whenReady().then(boot);
}

function boot(): void {
  let cipher: SecretCipher = plainCipher;
  if (safeStorage.isEncryptionAvailable()) {
    cipher = {
      available: () => safeStorage.isEncryptionAvailable(),
      secure: true,
      encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
      decrypt: (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64')),
    };
  } else {
    console.warn('[security] OS secret storage unavailable; API keys will only be obfuscated');
  }
  // users who never chose a UI language get their OS language (zh → zh, else en)
  const osLang = app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en';
  const userData = app.getPath('userData');
  const ctx: AppContext = {
    settings: new SettingsStore(join(userData, 'settings.json'), cipher, osLang),
    knowledge: new KnowledgeStore(join(userData, 'knowledge.md')),
    sessionStore: new SessionStore(join(userData, 'sessions.json')),
    asr: new AsrHost(),
    sidecar: new FunasrSidecar(),
    tray: new AppTray(),
    osLang,
    win: null,
    setupWin: null,
    quitting: false,
    pendingAsrRestart: false,
    capture: { active: false },
  };

  registerAppIpc(ctx);
  registerSetupIpc(ctx);
  registerAsrIpc(ctx);
  registerRegionPicker(ctx);
  const llm = registerLlmIpc(ctx);

  // capture lifecycle: tray label (开始转写 <-> 停止转写), prewarm keep-alive,
  // diagnostics timestamps, and the ASR flush of the last utterance
  ipcMain.on(IPC.captureStarted, () => {
    console.log('[main] capture started');
    ctx.capture.active = true;
    ctx.capture.lastStartedAt = new Date().toISOString();
    ctx.tray.refresh();
    llm.keepWarm(true);
  });
  ipcMain.on(IPC.captureStopped, () => {
    console.log('[main] capture stopped');
    ctx.capture.active = false;
    ctx.capture.lastStoppedAt = new Date().toISOString();
    ctx.tray.refresh();
    llm.keepWarm(false);
    ctx.asr.flush();
  });

  app.on('second-instance', () => showWindow(ctx.setupWin ?? ctx.win));

  app.on('before-quit', () => {
    ctx.quitting = true;
    globalShortcut.unregisterAll();
    ctx.tray.destroy();
    void ctx.asr.stop();
    void ctx.sidecar.stop();
  });

  /**
   * Still a quit, tray or not: hiding the overlay does NOT close it, so this
   * only fires on a real teardown (app.quit() destroying the windows, or the
   * first-run wizard being closed before completion). A "close to tray" app
   * would return here instead — MeetingCopilot deliberately has no window
   * close button that leaves the app running headless without a window.
   */
  app.on('window-all-closed', () => app.quit());

  // First run (or MC_FORCE_ONBOARDING=1 for testing): the wizard owns the
  // whole startup — no overlay window, no ASR worker, no sidecar spawn.
  if (process.env.MC_FORCE_ONBOARDING === '1' || !ctx.settings.data.onboarding.completed) {
    openSetupWindow(ctx);
  } else {
    startMainApp(ctx);
  }
}
