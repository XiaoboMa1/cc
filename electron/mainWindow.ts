/**
 * The overlay window with its tray icon, global hotkeys and auto-launch.
 *
 * Quit/hide matrix (Phase 4):
 *   hide  (hotkey / 「—」 / tray toggle) -> window stays alive, app keeps
 *         running, tray is the way back; NEVER quits.
 *   quit  (titlebar ✕ / tray 退出 / OS shutdown) -> app.quit() -> before-quit
 *         reaps the ASR utilityProcess, the python sidecar and the tray.
 *   first-run wizard closed without completing -> app.quit() (Phase 2), since
 *         nothing is configured and no main window exists yet.
 *   re-run wizard closed -> main window keeps running; window-all-closed does
 *         not fire because the overlay is still open (possibly hidden).
 */
import { app, BrowserWindow, globalShortcut } from 'electron';
import { join } from 'path';
import { IPC, type HotkeyAction } from '../shared/protocol';
import { isRendererCommand } from '../shared/trayMenu';
import { T, type AppContext } from './appContext';
import { startAsr } from './asrControl';
import { runMainWindowDevHooks } from './devHooks';
import { openExternalUrl } from './externalLinks';
import { getResourceRoot } from './resourcePaths';
import { trayIconPath } from './tray';

/** tray 「检查更新」 (Phase 4). A real updater is Phase 5; until then the honest
 * answer is the releases page, opened through the same allowlist as every other
 * documentation link. */
const RELEASES_URL = 'https://github.com/JWM0203/MeetingCopilot/releases/latest';

/** how far one hotkeyMove+arrow press moves the overlay */
const MOVE_STEP_PX = 40;

/**
 * Run a globalShortcut callback's work in a timer task: executeJavaScript
 * called straight from the callback was measured reaching the renderer only
 * at the next input event, 0.4–1.8 s after the key press (Electron 41, X11);
 * from a timer task it arrives within a few ms.
 */
export const deferred = (fn: () => void) => () => void setTimeout(fn, 0);

/** restore + show + focus; no-op for a window that does not exist */
export function showWindow(win: BrowserWindow | null): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleWindow(ctx: AppContext): void {
  if (!ctx.win) return;
  if (ctx.win.isVisible()) ctx.win.hide();
  else showWindow(ctx.win);
}

/**
 * 开机自动启动. Deliberately inert in development: `setLoginItemSettings`
 * would register the electron.exe dev launcher (and on Linux Electron does
 * not implement it at all), so the stored intent is kept and applied by the
 * installed build instead.
 */
export function applyAutoLaunch(enabled: boolean): void {
  if (process.platform === 'linux') return;
  if (!app.isPackaged) {
    console.log(`[autolaunch] ${enabled ? 'on' : 'off'} stored; not applied in a dev build`);
    return;
  }
  try {
    app.setLoginItemSettings({ openAtLogin: enabled });
  } catch (e) {
    console.warn('[autolaunch] could not be applied:', (e as Error).message);
  }
}

export function registerHotkeys(ctx: AppContext): void {
  globalShortcut.unregisterAll();
  const ui = ctx.settings.data.ui;
  // renderer actions run through executeJavaScript(…, userGesture=true), not
  // IPC: the capture hotkey ends in getDisplayMedia, which rejects without a
  // user gesture (same reason as the MC_AUTOSTART hook)
  const inRenderer = (action: HotkeyAction) => () =>
    void ctx.win?.webContents
      .executeJavaScript(`window.__mcHotkey && window.__mcHotkey(${JSON.stringify(action)})`, true)
      .catch((e) => console.warn(`[main] hotkey ${action} failed:`, (e as Error).message));
  const move = (dx: number, dy: number) => () => {
    if (!ctx.win) return;
    const [x, y] = ctx.win.getPosition();
    ctx.win.setPosition(x + dx * MOVE_STEP_PX, y + dy * MOVE_STEP_PX);
  };
  const bindings: [string, () => void][] = [
    [ui.hotkeyToggle, () => toggleWindow(ctx)],
    [ui.hotkeyShot, inRenderer('shot')],
    [ui.hotkeyShotUndo, inRenderer('shotUndo')],
    [ui.hotkeyShotClear, inRenderer('shotClear')],
    [ui.hotkeyAnswer, inRenderer('answer')],
    [ui.hotkeyFreeAsk, inRenderer('freeAsk')],
    [ui.hotkeyCapture, inRenderer('capture')],
    [ui.hotkeyClearAnswers, inRenderer('clearAnswers')],
    [ui.hotkeyClearTranscript, inRenderer('clearTranscript')],
  ];
  if (ui.hotkeyMove) {
    bindings.push(
      [`${ui.hotkeyMove}+Up`, move(0, -1)],
      [`${ui.hotkeyMove}+Down`, move(0, 1)],
      [`${ui.hotkeyMove}+Left`, move(-1, 0)],
      [`${ui.hotkeyMove}+Right`, move(1, 0)],
    );
  }
  for (const [accel, fn] of bindings) {
    if (!accel) continue;
    // per binding: one malformed accelerator must not drop the rest
    try {
      if (!globalShortcut.register(accel, deferred(fn))) {
        console.warn(`[main] hotkey ${accel} registration failed (in use?)`);
      }
    } catch (e) {
      console.warn(`[main] hotkey ${accel} register error:`, (e as Error).message);
    }
  }
}

function createWindow(ctx: AppContext): void {
  const win = new BrowserWindow({
    width: 940,
    height: 560,
    minWidth: 640,
    minHeight: 380,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  ctx.win = win;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setContentProtection(ctx.settings.data.ui.stealth);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.webContents.on('did-finish-load', () => {
    // replay cached ASR state for late-attaching renderer
    if (ctx.asr.lastReady) win.webContents.send(IPC.asrEvent, ctx.asr.lastReady);
    if (ctx.asr.lastStatus) win.webContents.send(IPC.asrEvent, ctx.asr.lastStatus);
    runMainWindowDevHooks(win);
  });

  // the tray menu shows 显示/隐藏窗口, so it has to follow the real state —
  // whichever of the four hide paths was used (hotkey, 「—」, tray, IPC)
  // "where did my window go" is THE support question for a frameless,
  // taskbar-less, content-protected overlay, so both transitions are logged
  win.on('show', () => {
    console.log('[window] shown');
    ctx.tray.refresh();
  });
  win.on('hide', () => {
    console.log('[window] hidden');
    ctx.tray.refresh();
    // one-shot balloon the first time the window disappears (spec §A)
    if (ctx.tray.exists && !ctx.settings.data.ui.trayNoticeShown) {
      ctx.settings.applyPatch({ ui: { trayNoticeShown: true } });
      const t = T(ctx);
      ctx.tray.notifyHidden(t.trayNoticeTitle, t.trayNoticeBody);
      console.log('[tray] hide notice shown once');
    }
  });
  win.on('closed', () => {
    ctx.win = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // the tray belongs to the running app, not to the first-run wizard: an
  // unconfigured machine that closes the wizard must still quit (Phase 2).
  // create() is a no-op once the icon exists.
  ctx.tray.create({
    iconPath: trayIconPath(getResourceRoot()),
    labels: () => T(ctx).tray,
    state: () => ({ windowVisible: !!ctx.win?.isVisible(), capturing: ctx.capture.active }),
    onCommand: (command) => {
      if (command === 'quit') app.quit();
      else if (command === 'toggle-window') toggleWindow(ctx);
      else if (command === 'check-updates') void openExternalUrl(RELEASES_URL);
      else if (isRendererCommand(command)) {
        // capture, sessions and the panels live in the renderer; a hidden
        // window would swallow the result, so make it visible first
        showWindow(ctx.win);
        ctx.win?.webContents.send(IPC.trayCommand, { command });
      }
    },
    onClick: () => toggleWindow(ctx),
    onDoubleClick: () => showWindow(ctx.win),
  });
}

/** normal boot: warm the ASR worker, bind hotkeys, show the overlay */
export function startMainApp(ctx: AppContext): void {
  void startAsr(ctx);
  registerHotkeys(ctx);
  // auto-launch: the OS is the source of truth; reconcile it with the stored
  // intent once (see applyAutoLaunch for why dev builds are skipped)
  if (process.platform !== 'linux' && app.isPackaged) {
    const wanted = !!ctx.settings.data.ui.autoLaunch;
    try {
      if (app.getLoginItemSettings().openAtLogin !== wanted) applyAutoLaunch(wanted);
    } catch (e) {
      console.warn('[autolaunch] could not be read:', (e as Error).message);
    }
  }
  createWindow(ctx);
}
