/**
 * IPC for settings, provider connection tests, diagnostics, the knowledge /
 * session files, and the app-shell services shared by the wizard and the
 * main window.
 */
import { app, clipboard, dialog, ipcMain, shell } from 'electron';
import { readFileSync } from 'fs';
import { release } from 'os';
import { basename } from 'path';
import {
  HOTKEY_FIELDS,
  IPC,
  type AppInfo,
  type ProviderTestRequest,
  type ProviderTestResult,
  type PublicSettings,
  type SessionsFile,
  type SettingsPatch,
} from '../shared/protocol';
import { T, type AppContext } from './appContext';
import { restartAsr } from './asrControl';
import {
  LocalPythonProbe,
  buildDiagnosticsReport,
  recentDiagnosticErrors,
  recordDiagnosticError,
} from './diagnostics';
import { DOC_EXTENSIONS, extractDocText } from './docparse';
import { openExternalUrl } from './externalLinks';
import { pythonCandidates, resolvePython } from './funasrSidecar';
import { PROMPT_LOG_PATH } from './llmIpc';
import { applyAutoLaunch, registerHotkeys } from './mainWindow';
import { syncPromptLogSession } from './promptLog';
import { resolveTestApiKey, runProviderTest, withoutCandidateKey } from './providerTest';
import { getResourceRoot } from './resourcePaths';

export function registerAppIpc(ctx: AppContext): void {
  const { settings, knowledge, asr } = ctx;

  /** getPublic() + real knowledge char count (KB lives outside settings.json) */
  const publicSettings = (): PublicSettings => ({ ...settings.getPublic(), knowledge: { chars: knowledge.chars } });

  // ---- settings ----
  ipcMain.handle(IPC.settingsGet, () => publicSettings());
  ipcMain.handle(IPC.settingsSet, (_e, patch: SettingsPatch) => {
    settings.applyPatch(patch);
    if (HOTKEY_FIELDS.some((k) => patch.ui?.[k] !== undefined)) registerHotkeys(ctx);
    if (patch.ui?.stealth !== undefined) ctx.win?.setContentProtection(patch.ui.stealth);
    // the tray menu is a snapshot: rebuild it in the newly chosen language
    if (patch.ui?.lang !== undefined) ctx.tray.refresh();
    if (patch.ui?.autoLaunch !== undefined) applyAutoLaunch(patch.ui.autoLaunch);
    // backend/cloud change => rebuild the ASR worker with the new engine.
    // language alone can hot-update without a restart.
    const a = patch.asr;
    if (
      a &&
      (a.backend !== undefined || a.cloud !== undefined || a.realtime !== undefined || a.localRealtime !== undefined)
    ) {
      // While the wizard is up the engine must NOT be rebuilt per key save:
      // on a first run nothing is configured yet (a restart would spawn the
      // local python sidecar the user never agreed to), and in a re-run it
      // would bounce the live engine once per card. The wizard writes its
      // plan as one final patch; the restart happens exactly once after it.
      if (ctx.setupWin || !settings.data.onboarding.completed) ctx.pendingAsrRestart = true;
      else void restartAsr(ctx);
    } else if (a?.language) {
      asr.setLanguage(a.language);
    }
    return publicSettings();
  });
  ipcMain.handle(IPC.stealthSet, (_e, on: boolean) => {
    settings.applyPatch({ ui: { stealth: on } });
    ctx.win?.setContentProtection(on);
    return on;
  });
  ipcMain.on(IPC.winHide, () => ctx.win?.hide());
  ipcMain.on(IPC.appQuit, () => app.quit());

  // ---- app shell services (wizard + main window) ----
  // The renderer never navigates: window.open is denied and will-navigate is
  // prevented, so documentation links come back here to be validated.
  ipcMain.handle(IPC.externalOpen, (_e, url: unknown) => openExternalUrl(url));
  // read on an explicit paste-button click only — never polled
  ipcMain.handle(IPC.clipboardReadText, () => clipboard.readText());
  ipcMain.handle(
    IPC.appGetInfo,
    (): AppInfo => ({ version: app.getVersion(), platform: process.platform, packaged: app.isPackaged }),
  );

  // ---- provider connection tests (Phase 3) ----
  // Runs ONLY on an explicit user action from the wizard or Settings. The
  // candidate key lives in a local const for the duration of one call: it is
  // never persisted here, never logged, and never travels back to the
  // renderer inside the result.
  ipcMain.handle(IPC.providerTest, async (_e, incoming: ProviderTestRequest): Promise<ProviderTestResult> => {
    const req = incoming ?? ({} as ProviderTestRequest);
    const apiKey = resolveTestApiKey(req, (slot) => settings.getApiKeyForSlot(slot));
    // the plaintext candidate stops here: everything downstream sees a
    // request without it, and the key only as a separate argument
    const request = withoutCandidateKey(req);
    const result = await runProviderTest({ ...request, language: request.language ?? settings.data.asr.language }, apiKey);
    // one dedicated write; applyPatch() would restart the ASR engine
    if (request.slot) {
      settings.recordVerification(request.slot, {
        lastTestAt: new Date().toISOString(),
        lastTestOk: result.ok,
        lastTestCode: result.code,
        latencyMs: result.latencyMs,
      });
    }
    if (!result.ok) {
      recordDiagnosticError(
        `provider-test/${request.capability}`,
        `${result.code} (${request.providerId} ${request.model})`,
      );
    }
    console.log(
      `[provider-test] ${request.capability} ${request.providerId} -> ${result.code} (${result.latencyMs ?? '?'}ms)`,
    );
    return result;
  });

  // ---- local diagnostics (Phase 3) ----
  // Purely local: built on request, returned to the renderer for the user to
  // copy. Nothing is uploaded, nothing is written to disk, and the builder
  // never receives a key, a transcript or any knowledge-base text.
  const pythonProbe = new LocalPythonProbe(() => resolvePython(pythonCandidates(getResourceRoot())));
  ipcMain.handle(IPC.diagnosticsGet, (): string => {
    pythonProbe.start(); // background; 'unknown' until it settles
    const ready = asr.lastReady?.kind === 'ready' ? asr.lastReady : null;
    const status = asr.lastStatus?.kind === 'status' ? asr.lastStatus : null;
    return buildDiagnosticsReport({
      appVersion: app.getVersion(),
      packaged: app.isPackaged,
      platform: process.platform,
      arch: process.arch,
      osRelease: release(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      uiLang: ctx.osLang,
      settings: settings.data,
      weakCrypto: settings.getPublic().weakCrypto,
      knowledgeChars: knowledge.chars,
      capture: {
        active: ctx.capture.active,
        lastStartedAt: ctx.capture.lastStartedAt,
        lastStoppedAt: ctx.capture.lastStoppedAt,
      },
      asr: { ready: !!ready, ep: ready?.ep, gpuSuspect: ready?.gpuSuspect, state: status?.state },
      localPython: pythonProbe.status,
      errors: recentDiagnosticErrors(),
      generatedAt: new Date(),
    });
  });
  ipcMain.handle(IPC.logsOpenFolder, async (): Promise<boolean> => {
    // userData holds settings.json, sessions.json and knowledge.md -- the
    // exact folder a user needs when asked to check or wipe their data
    const err = await shell.openPath(app.getPath('userData'));
    if (err) console.warn('[diagnostics] could not open the data folder:', err);
    return err === '';
  });

  // ---- knowledge base + per-session resume / JD documents ----
  ipcMain.handle(IPC.knowledgeImport, async () => {
    const r = await dialog.showOpenDialog({
      title: T(ctx).kbImportTitle,
      filters: [{ name: 'Markdown/Text', extensions: ['md', 'markdown', 'txt'] }],
      properties: ['openFile'],
    });
    if (!r.canceled && r.filePaths[0]) {
      try {
        knowledge.setFromText(readFileSync(r.filePaths[0], 'utf8'));
      } catch (e) {
        console.error('[knowledge] import failed:', (e as Error).message);
      }
    }
    return { chars: knowledge.chars };
  });
  ipcMain.handle(IPC.knowledgeClear, () => {
    knowledge.clear();
    return { chars: knowledge.chars };
  });
  ipcMain.handle(IPC.knowledgePick, async (_e, slot: 'resume' | 'jd' = 'resume') => {
    const t = T(ctx);
    const r = await dialog.showOpenDialog({
      title: slot === 'jd' ? t.pickJdTitle : t.pickResumeTitle,
      filters: [{ name: t.docFilter, extensions: [...DOC_EXTENSIONS] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    try {
      // deterministic parse (mammoth / pdf-parse) — no LLM in the loop;
      // '' for scanned PDFs, the renderer warns the user
      const text = await extractDocText(r.filePaths[0]);
      return { name: basename(r.filePaths[0]), text, chars: text.length };
    } catch (e) {
      console.error('[knowledge] pick failed:', (e as Error).message);
      return null;
    }
  });

  // ---- sessions file ----
  ipcMain.handle(IPC.sessionsLoad, () => ctx.sessionStore.load());
  ipcMain.on(IPC.sessionsSave, (_e, data: SessionsFile) => {
    ctx.sessionStore.save(data);
    if (PROMPT_LOG_PATH) {
      for (const s of data.sessions) syncPromptLogSession(s.id, (s.segments ?? []).map((g) => g.id));
    }
  });
}
