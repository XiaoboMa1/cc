export type CaptureKind = 'loopback' | 'input';

/** Electron's display-media loopback token is currently Windows-only. */
export function captureKindForPlatform(platform: string): CaptureKind {
  return platform === 'win32' ? 'loopback' : 'input';
}

/** Defaults apply only to newly created settings; saved user choices win. */
export function defaultHotkeysForPlatform(
  platform: string,
): { toggle: string; shot: string; shotUndo: string; shotClear: string } {
  if (platform === 'darwin') {
    // NOTE: macOS itself intercepts Command+H as "Hide <app>" on most
    // systems, so globalShortcut.register may lose that race silently — the
    // user can rebind it in settings if it never fires.
    return { toggle: 'Command+B', shot: 'Command+H', shotUndo: 'Command+L', shotClear: 'Command+R' };
  }
  return { toggle: 'Control+B', shot: 'Control+H', shotUndo: 'Control+L', shotClear: 'Control+R' };
}

export function whisperExecutionProvidersForPlatform(
  platform: string,
): ('dml' | 'cpu')[] {
  return platform === 'win32' ? ['dml', 'cpu'] : ['cpu'];
}
