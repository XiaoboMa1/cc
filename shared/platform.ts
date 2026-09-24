import type { HotkeySettings } from './protocol';

export type CaptureKind = 'loopback' | 'input';

/** Electron's display-media loopback token is currently Windows-only. */
export function captureKindForPlatform(platform: string): CaptureKind {
  return platform === 'win32' ? 'loopback' : 'input';
}

/** Defaults apply only to newly created settings; saved user choices win. */
export function defaultHotkeysForPlatform(platform: string): HotkeySettings {
  // NOTE: macOS itself intercepts Command+H as "Hide <app>" on most systems,
  // so globalShortcut.register may lose that race silently — the user can
  // rebind it in settings if it never fires.
  const mod = platform === 'darwin' ? 'Command' : 'Control';
  return {
    hotkeyToggle: `${mod}+B`,
    hotkeyShot: `${mod}+H`,
    hotkeyShotUndo: `${mod}+L`,
    hotkeyShotClear: `${mod}+R`,
    hotkeyAnswer: `${mod}+Enter`,
    hotkeyCapture: `${mod}+S`,
    hotkeyClearAnswers: `${mod}+D`,
    hotkeyClearTranscript: `${mod}+T`,
    hotkeyMove: mod,
  };
}

export function whisperExecutionProvidersForPlatform(
  platform: string,
): ('dml' | 'cpu')[] {
  return platform === 'win32' ? ['dml', 'cpu'] : ['cpu'];
}
