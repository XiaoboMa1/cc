/**
 * First-run gate and the wizard's IPC. While the wizard is up there is no ASR
 * worker, no python sidecar, no cloud connection and no LLM prewarm — an
 * unconfigured machine must not spawn anything.
 */
import { app, dialog, ipcMain } from 'electron';
import {
  IPC,
  type OnboardingCompletePayload,
  type OnboardingProgressPatch,
} from '../shared/protocol';
import { T, type AppContext } from './appContext';
import { restartAsr } from './asrControl';
import { showWindow, startMainApp } from './mainWindow';
import { SETUP_READY_MARKER, createSetupWindow } from './setupWindow';

/**
 * @param rerun the wizard was reopened from a running main window (设置 →
 * 重新运行配置向导 / the upgrade notice). Re-run mode never quits the app.
 */
export function openSetupWindow(ctx: AppContext, rerun = false): void {
  if (ctx.setupWin) {
    showWindow(ctx.setupWin);
    return;
  }
  const w = createSetupWindow();
  ctx.setupWin = w;

  // E2E: drive the wizard->main-app handover without a human click
  if (process.env.MC_E2E_ONBOARDING_COMPLETE === '1') {
    w.webContents.on('did-finish-load', () => {
      void w.webContents.executeJavaScript('window.mcSetup.completeOnboarding({})', true);
    });
  }

  w.on('close', (e) => {
    // completion closes this window programmatically, an OS shutdown /
    // app.quit() must never be blocked by a modal, and a re-run just puts
    // the user back into a working app — no prompt in any of those cases
    if (ctx.quitting || rerun || ctx.settings.data.onboarding.completed) return;
    const t = T(ctx);
    const choice = dialog.showMessageBoxSync(w, {
      type: 'warning',
      title: t.setupQuitTitle,
      message: t.setupQuitTitle,
      detail: t.setupQuitMessage,
      buttons: [t.setupQuitConfirm, t.setupQuitCancel],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (choice !== 0) e.preventDefault();
  });

  w.on('closed', () => {
    ctx.setupWin = null;
    if (rerun) {
      // keys saved before the user backed out still have to reach the engine
      if (ctx.pendingAsrRestart) {
        ctx.pendingAsrRestart = false;
        void restartAsr(ctx);
      }
      ctx.win?.focus();
      return;
    }
    // first-run launch closed without finishing => nothing is configured and
    // there is no other window
    if (!ctx.settings.data.onboarding.completed) app.quit();
  });
}

export function registerSetupIpc(ctx: AppContext): void {
  const { settings } = ctx;
  let wizardReadyLogged = false;
  ipcMain.handle(IPC.onboardingGet, (e) => {
    // one-shot boot marker: the wizard's own renderer reached main, which
    // proves setup.html loaded, its module graph ran and the setup preload
    // bridge is live. tools/packaged-smoke.mjs asserts it.
    if (!wizardReadyLogged && ctx.setupWin && e.sender === ctx.setupWin.webContents) {
      wizardReadyLogged = true;
      console.log(SETUP_READY_MARKER);
    }
    return settings.getOnboarding();
  });
  ipcMain.handle(IPC.onboardingSaveProgress, (_e, patch: OnboardingProgressPatch = {}) =>
    settings.saveOnboardingProgress(patch ?? {}),
  );
  ipcMain.handle(IPC.onboardingComplete, (_e, payload: OnboardingCompletePayload = {}) => {
    const state = settings.completeOnboarding(payload ?? {});
    // create the main window BEFORE closing the wizard: closing the last
    // window first would fire window-all-closed and quit the app mid-handover
    if (!ctx.win) {
      // startMainApp() already builds the engine from the finished settings
      startMainApp(ctx);
    } else if (ctx.pendingAsrRestart) {
      // re-run: the main window kept running, so apply the deferred rebuild
      void restartAsr(ctx);
    }
    ctx.pendingAsrRestart = false;
    ctx.setupWin?.close();
    return state;
  });
  // main window -> "重新运行配置向导" / the upgrade notice
  ipcMain.handle(IPC.onboardingRerun, () => {
    openSetupWindow(ctx, true);
    return true;
  });
}
