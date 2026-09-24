import type { McApi } from '../electron/preload';
import type { McSetupApi } from '../electron/setupPreload';
import type { HotkeyAction } from '../shared/protocol';

declare global {
  interface Window {
    mc: McApi;
    /** setup window only (src/setup.html + electron/setupPreload.ts) */
    mcSetup: McSetupApi;
    /** E2E hook: main calls this (with user gesture) when MC_AUTOSTART=1 */
    __mcAutoStart?: () => void;
    /** a global hotkey fired (electron/main.ts registerHotkeys runs this with
     * a user gesture, which the capture hotkey's getDisplayMedia needs) */
    __mcHotkey?: (action: HotkeyAction) => void;
    /** visual-QA hooks: main calls these when MC_MAIN_SHOT=<dir> */
    __mcOpenSettings?: () => void;
    __mcOpenHelp?: () => void;
  }
}

export {};
