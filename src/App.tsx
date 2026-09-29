import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PublicSettings } from '../shared/protocol';
import { deriveServiceHealth } from '../shared/healthState';
import { AnswerSession, type AnswerSessionHandle } from './components/AnswerSession';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { HelpPanel } from './components/HelpPanel';
import { ServiceHealthPanel } from './components/ServiceHealthPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { StatusBar } from './components/StatusBar';
import { TitleBar } from './components/TitleBar';
import { TranscriptPanel } from './components/TranscriptPanel';
import { useAnswering } from './hooks/useAnswering';
import { useAsrStream } from './hooks/useAsrStream';
import { useAudioCapture } from './hooks/useAudioCapture';
import { useSessions } from './hooks/useSessions';
import { useShotQueue } from './hooks/useShotQueue';
import { I18nProvider, getDict, type Dict } from './i18n';

/** the overlay panels are mutually exclusive: one at a time, never stacked */
type Panel = 'settings' | 'health' | 'diagnostics' | 'help' | null;

export function App() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [showHud, setShowHud] = useState(true);
  const answerRef = useRef<AnswerSessionHandle>(null);

  // UI language: settings-driven; ref mirror so stable callbacks stay fresh
  const t = getDict(settings?.ui.lang);
  const tRef = useRef<Dict>(t);
  tRef.current = t;

  const sessions = useSessions(tRef);
  const stream = useAsrStream(sessions.appendSegment);
  const shots = useShotQueue(sessions.currentIdRef);
  const capture = useAudioCapture({
    settings,
    onSettings: setSettings,
    reportError: stream.reportError,
    prewarm: sessions.prewarm,
    tRef,
  });
  const answering = useAnswering({ sessions, shots, partialsRef: stream.partialsRef, mic: capture.mic, tRef });
  const { current, currentIdRef, createSession, clearAnswers, clearTranscript } = sessions;
  const { captureShot, undoLastShot, clearShotQueue } = shots;
  const { askLlm } = answering;
  const { asr } = stream;
  const { capturing, startCapture, stopCapture } = capture;

  useEffect(() => {
    void window.mc.getSettings().then(setSettings);
    // visual-QA hooks (MC_MAIN_SHOT in electron/devHooks.ts): open a panel
    // from the main process so it can be screenshotted
    window.__mcOpenSettings = () => setPanel('settings');
    window.__mcOpenHelp = () => setPanel('help');
  }, []);

  // ---- apply UI theme + answer font scale to the document root ----
  useEffect(() => {
    const ui = settings?.ui;
    if (!ui) return;
    document.documentElement.dataset.fontScale = ui.fontScale ?? 'medium';
    const apply = () => {
      const mode = ui.theme ?? 'dark';
      const dark =
        mode === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches : mode === 'dark';
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    if ((ui.theme ?? 'dark') !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings]);

  /** 开始/停止: the title-bar button, the tray entry and the capture hotkey
   * all run this, readiness check included, so they can never disagree */
  const toggleCapture = useCallback(() => {
    if (capturing) void stopCapture();
    else if (asr.phase === 'ready') void startCapture();
  }, [capturing, asr.phase, startCapture, stopCapture]);

  /**
   * Tray menu commands (Phase 4 §A; main forwards only what it cannot do
   * itself and has already made the window visible) and global hotkeys
   * (electron/mainWindow.ts registerHotkeys calls window.__mcHotkey).
   * Re-bound whenever a handler changes — cheaper and less error-prone than
   * a fistful of refs.
   */
  useEffect(() => {
    const offTray = window.mc.onTrayCommand(({ command }) => {
      if (command === 'toggle-capture') toggleCapture();
      else if (command === 'new-session') createSession();
      else if (command === 'open-settings') setPanel('settings');
      else if (command === 'open-health') setPanel('health');
      else if (command === 'open-help') setPanel('help');
    });
    window.__mcHotkey = (action) => {
      if (action === 'shot') void captureShot();
      else if (action === 'shotUndo') undoLastShot();
      else if (action === 'shotClear') clearShotQueue();
      else if (action === 'answer') void askLlm('continuous');
      else if (action === 'freeAsk') answerRef.current?.submit();
      else if (action === 'capture') toggleCapture();
      else if (action === 'clearAnswers') clearAnswers();
      else if (action === 'clearTranscript') clearTranscript();
    };
    return () => {
      offTray();
      window.__mcHotkey = undefined;
    };
  }, [toggleCapture, createSession, captureShot, undoLastShot, clearShotQueue, askLlm, clearAnswers, clearTranscript]);

  /** the v1 -> v2 migration marks hand-configured profiles; show the notice
   * once until the user dismisses it (persisted in onboarding state) */
  const showUpgradeNotice =
    !!settings &&
    settings.version === 2 &&
    settings.onboarding.completed &&
    !!settings.onboarding.migratedFromV1 &&
    !settings.onboarding.dismissedUpgradePrompt;

  const visionReady =
    !!settings?.llm.answerWithVision &&
    !!settings?.vision.baseUrl &&
    !!settings?.vision.model &&
    !!settings?.vision.apiKeySet;

  /**
   * One derivation for the status chips, the health panel and the answer
   * gating (shared/healthState.ts). A missing LLM key disables the answer
   * buttons with an explanation instead of letting every click produce the
   * same main-process error turn — but it never blocks transcription.
   */
  const health = useMemo(
    () => (settings ? deriveServiceHealth({ settings, asr, capturing }) : null),
    [settings, asr, capturing],
  );
  const answersReady = health?.answersAvailable ?? true;
  const closePanel = () => setPanel(null);

  return (
    <I18nProvider lang={settings?.ui.lang}>
      <div className="app">
        <TitleBar
          settings={settings}
          onSettings={setSettings}
          capture={capture}
          asrReady={asr.phase === 'ready'}
          onToggleCapture={toggleCapture}
          continuous={answering.continuous}
          onToggleContinuous={() => answering.setContinuous((v) => !v)}
          hr={current?.interviewType === 'hr'}
          onToggleInterviewType={sessions.toggleInterviewType}
          onToggleHud={() => setShowHud((v) => !v)}
          onToggleSettings={() => setPanel((p) => (p === 'settings' ? null : 'settings'))}
        />

        {/* grandfathered users (settings.json predates the wizard) get one
            dismissible pointer at the new wizard; wizard-created profiles never
            carry onboarding.migratedFromV1, so they never see it */}
        {showUpgradeNotice && (
          <div className="upgrade-banner">
            <span>{t.app.upgradeNotice}</span>
            <button className="btn btn-sm btn-primary" onClick={() => void window.mc.rerunOnboarding()}>
              {t.app.upgradeCheck}
            </button>
            <button
              className="btn btn-sm"
              onClick={async () => {
                const onboarding = await window.mc.saveOnboardingProgress({ dismissedUpgradePrompt: true });
                setSettings((s) => (s ? { ...s, onboarding } : s));
              }}
            >
              {t.app.upgradeSkip}
            </button>
          </div>
        )}

        {panel === 'health' && settings && health && (
          <ServiceHealthPanel
            settings={settings}
            health={health}
            onClose={closePanel}
            onOpenSettings={() => setPanel('settings')}
            onOpenDiagnostics={() => setPanel('diagnostics')}
            onSettingsRefreshed={setSettings}
          />
        )}

        {panel === 'diagnostics' && <DiagnosticsPanel onClose={closePanel} />}

        {panel === 'help' && (
          <HelpPanel
            onClose={closePanel}
            onOpenSettings={() => setPanel('settings')}
            onOpenDiagnostics={() => setPanel('diagnostics')}
          />
        )}

        {panel === 'settings' && settings && (
          <SettingsPanel
            settings={settings}
            onSaved={(s) => {
              setSettings(s);
              closePanel();
            }}
            onClose={closePanel}
            onRerunWizard={() => {
              closePanel();
              void window.mc.rerunOnboarding();
            }}
            onOpenDiagnostics={() => setPanel('diagnostics')}
            onOpenHelp={() => setPanel('help')}
          />
        )}

        <div className="panes">
          <TranscriptPanel
            segments={current?.segments ?? []}
            partials={stream.partials}
            answersReady={answersReady}
            answersHint={t.health.answersDisabled}
            onAsk={(text) => askLlm('segment', text)}
            onTranslate={answering.translateSegment}
            onClear={clearTranscript}
          />
          <AnswerSession
            ref={answerRef}
            sessions={sessions.sessions}
            currentId={sessions.currentId}
            turns={current?.turns ?? []}
            resumeName={current?.resumeName}
            resumeChars={current?.resumeText?.length ?? 0}
            jdName={current?.jdName}
            jdChars={current?.jdText?.length ?? 0}
            notice={sessions.kbNotice}
            visionReady={visionReady}
            answersReady={answersReady}
            answersHint={t.health.answersDisabled}
            onSwitch={sessions.setCurrentId}
            onNew={createSession}
            onDelete={(id) => {
              sessions.deleteSession(id);
              // S cannot outlast its session: drop the queue, cancelling any extraction
              clearShotQueue(id);
            }}
            onRename={sessions.renameSession}
            onPickKb={(slot) => void sessions.pickKb(slot)}
            onClearKb={sessions.clearKb}
            onCancel={answering.cancelTurn}
            onClear={clearAnswers}
            onFreeAsk={(q) => (q ? askLlm('free', q) : askLlm('continuous'))}
            onShotAsk={answering.askShot}
            shotQueue={shots.shotQueues[sessions.currentId] ?? []}
            onShotQueueRemove={(id) => shots.removeShotQueueItem(currentIdRef.current, id)}
            onShotQueueClear={() => clearShotQueue()}
          />
        </div>

        <StatusBar
          asr={asr}
          capturing={capturing}
          hud={showHud ? stream.hud : undefined}
          health={health ?? undefined}
          onOpenHealth={() => setPanel((p) => (p === 'health' ? null : 'health'))}
        />
      </div>
    </I18nProvider>
  );
}
