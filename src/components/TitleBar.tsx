import type { PublicSettings } from '../../shared/protocol';
import type { AudioCaptureApi } from '../hooks/useAudioCapture';
import { useT } from '../i18n';

/**
 * Title bar: capture and mode toggles on the left, window controls on the
 * right. The frameless overlay is dragged by this bar (styles.css .titlebar).
 */
export function TitleBar({
  settings,
  onSettings,
  capture,
  asrReady,
  onToggleCapture,
  continuous,
  onToggleContinuous,
  hr,
  onToggleInterviewType,
  onToggleHud,
  onToggleSettings,
}: {
  settings: PublicSettings | null;
  onSettings: (s: PublicSettings) => void;
  capture: AudioCaptureApi;
  asrReady: boolean;
  onToggleCapture: () => void;
  continuous: boolean;
  onToggleContinuous: () => void;
  /** the current session's interview type is HR (else tech) */
  hr: boolean;
  onToggleInterviewType: () => void;
  onToggleHud: () => void;
  onToggleSettings: () => void;
}) {
  const t = useT();
  const { capturing, micActive, mics, inputMode } = capture;

  const toggleStealth = async () => {
    if (!settings) return;
    const on = await window.mc.setStealth(!settings.ui.stealth);
    onSettings({ ...settings, ui: { ...settings.ui, stealth: on } });
  };

  const toggleAnswerModel = async () => {
    if (!settings) return;
    onSettings(await window.mc.setSettings({ llm: { answerWithVision: !settings.llm.answerWithVision } }));
  };

  return (
    <header className="titlebar">
      <span className="brand">MeetingCopilot</span>
      <div className="titlebar-actions">
        <button
          className={capturing ? 'btn btn-live' : 'btn btn-primary'}
          onClick={onToggleCapture}
          disabled={!asrReady}
          title={
            inputMode
              ? capturing
                ? t.titlebar.stopInputTitle
                : t.titlebar.startInputTitle
              : capturing
                ? t.titlebar.stopTitle
                : t.titlebar.startTitle
          }
        >
          {capturing ? t.titlebar.stop : t.titlebar.start}
        </button>
        {inputMode && mics.length > 0 && (
          <select
            className="mic-select"
            value={settings?.audio.themDeviceId ?? ''}
            onChange={(e) => void capture.selectThemInput(e.target.value)}
            title={t.titlebar.themDeviceTitle}
          >
            <option value="">{t.titlebar.themDeviceDefault}</option>
            {mics.map((m) => (
              <option key={m.deviceId} value={m.deviceId}>
                {(m.label || t.titlebar.themDeviceDefault).slice(0, 14)}
              </option>
            ))}
          </select>
        )}
        <button
          className={continuous ? 'btn btn-on' : 'btn'}
          onClick={onToggleContinuous}
          title={t.titlebar.continuousTitle}
        >
          {t.titlebar.continuous}
        </button>
        <button
          className={settings?.llm.answerWithVision ? 'btn btn-on' : 'btn'}
          onClick={() => void toggleAnswerModel()}
          title={t.titlebar.modelTitle}
        >
          {settings?.llm.answerWithVision ? t.titlebar.vision : t.titlebar.textOnly}
        </button>
        <button className="btn" onClick={onToggleInterviewType} title={t.titlebar.interviewTypeTitle}>
          {t.titlebar.interviewType(hr)}
        </button>
        <button
          className={micActive ? 'btn btn-live' : 'btn'}
          onClick={() => void capture.toggleMicCapture()}
          title={t.titlebar.micTitle}
        >
          {micActive ? t.titlebar.micOn : t.titlebar.micOff}
        </button>
        {micActive && mics.length > 0 && (
          <select
            className="mic-select"
            value={settings?.audio.micDeviceId ?? ''}
            onChange={(e) => void capture.selectMic(e.target.value)}
            title={t.titlebar.micDeviceTitle}
          >
            <option value="">{t.titlebar.micDefault}</option>
            {mics.map((m) => (
              <option key={m.deviceId} value={m.deviceId}>
                {(m.label || t.titlebar.micDefault).slice(0, 10)}
              </option>
            ))}
          </select>
        )}
        <button
          className={settings?.ui.stealth ? 'btn btn-on' : 'btn'}
          onClick={() => void toggleStealth()}
          title={window.mc.platform === 'darwin' ? t.titlebar.stealthMacTitle : t.titlebar.stealthTitle}
        >
          {t.titlebar.stealth(!!settings?.ui.stealth)}
        </button>
        <button className="btn" onClick={onToggleHud} title={t.titlebar.hudTitle}>
          HUD
        </button>
      </div>
      <div className="titlebar-window-controls">
        <button className="btn" onClick={onToggleSettings} title={t.titlebar.settingsTitle}>
          {t.titlebar.settingsTitle}
        </button>
        <button className="btn" onClick={() => window.mc.hide()} title={t.titlebar.hideTitle}>
          —
        </button>
        <button className="btn btn-close" onClick={() => window.mc.quit()} title={t.titlebar.quitTitle}>
          ✕
        </button>
      </div>
    </header>
  );
}
