import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { PublicSettings } from '../../shared/protocol';
import { captureKindForPlatform } from '../../shared/platform';
import { LoopbackCapture } from '../audio/loopbackCapture';
import { MicCapture, listMics } from '../audio/micCapture';
import type { Dict } from '../i18n';

const sendThem = (buf: ArrayBuffer, ts: number) => window.mc.sendPcm(buf, ts, 'them');
const sendMe = (buf: ArrayBuffer, ts: number) => window.mc.sendPcm(buf, ts, 'me');

export type AudioCaptureApi = ReturnType<typeof useAudioCapture>;

/**
 * The two audio channels. 'them' (the interviewer): Windows captures Electron
 * system loopback; macOS/Linux capture a selected ordinary input (typically
 * a virtual audio device carrying meeting/system audio). 'me': the
 * microphone, started and stopped independently of 'them'.
 */
export function useAudioCapture({
  settings,
  onSettings,
  reportError,
  prewarm,
  tRef,
}: {
  settings: PublicSettings | null;
  onSettings: (s: PublicSettings) => void;
  reportError: (message: string) => void;
  prewarm: (immediate: boolean) => void;
  tRef: RefObject<Dict>;
}) {
  const [capturing, setCapturing] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [mics, setMics] = useState<{ deviceId: string; label: string }[]>([]);
  const [inputMode] = useState(() => captureKindForPlatform(window.mc.platform) === 'input');
  const [loopback] = useState(() => new LoopbackCapture());
  const [themInput] = useState(() => new MicCapture());
  const [mic] = useState(() => new MicCapture());
  const busyRef = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const startCapture = useCallback(async () => {
    // running only turns true once start() resolves; a second call while
    // getDisplayMedia is pending (capture hotkey pressed twice) would open a
    // second stream sending the same audio again
    if ((inputMode ? themInput : loopback).running || busyRef.current) return;
    busyRef.current = true;
    try {
      if (inputMode) {
        await themInput.start(settingsRef.current?.audio.themDeviceId, sendThem, { audioProcessing: false });
        void listMics().then(setMics).catch(() => undefined);
      } else {
        await loopback.start(sendThem);
      }
      window.mc.captureStarted();
      setCapturing(true);
      prewarm(true); // ▶ = the meeting starts — build the KV prefix cache now
    } catch (e) {
      reportError(tRef.current.app.captureStartFail((e as Error).message));
    } finally {
      busyRef.current = false;
    }
  }, [inputMode, themInput, loopback, prewarm, reportError, tRef]);

  const stopCapture = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await (inputMode ? themInput : loopback).stop();
      window.mc.captureStopped();
      setCapturing(false);
    } finally {
      busyRef.current = false;
    }
  }, [inputMode, themInput, loopback]);

  // E2E hook: main calls this (with a user gesture) when MC_AUTOSTART=1
  useEffect(() => {
    window.__mcAutoStart = () => void startCapture();
  }, [startCapture]);

  const toggleMicCapture = useCallback(async () => {
    if (mic.running) {
      await mic.stop();
      setMicActive(false);
      return;
    }
    try {
      await mic.start(settingsRef.current?.audio.micDeviceId, sendMe);
      setMicActive(true);
      if (mics.length === 0) void listMics().then(setMics);
    } catch (e) {
      // the name tells the cause (NotAllowedError: Windows privacy switch;
      // NotReadableError: another app holds the device); the message can be empty
      const err = e as Error;
      reportError(tRef.current.app.micStartFail(`${err.name}: ${err.message}`));
    }
  }, [mic, mics, reportError, tRef]);

  const selectMic = useCallback(
    async (deviceId: string) => {
      onSettings(await window.mc.setSettings({ audio: { micDeviceId: deviceId || undefined } }));
      // if the mic is currently on, restart it on the newly chosen device
      if (mic.running) {
        await mic.stop();
        await mic.start(deviceId || undefined, sendMe).catch(() => setMicActive(false));
      }
    },
    [mic, onSettings],
  );

  const selectThemInput = useCallback(
    async (deviceId: string) => {
      const updated = await window.mc.setSettings({ audio: { themDeviceId: deviceId || undefined } });
      onSettings(updated);
      settingsRef.current = updated;
      if (themInput.running) {
        await themInput.stop();
        await themInput.start(deviceId || undefined, sendThem, { audioProcessing: false }).catch((e) => {
          window.mc.captureStopped();
          setCapturing(false);
          reportError(tRef.current.app.themInputSwitchFail((e as Error).message));
        });
      }
    },
    [themInput, onSettings, reportError, tRef],
  );

  return {
    inputMode,
    capturing,
    micActive,
    mics,
    mic,
    startCapture,
    stopCapture,
    toggleMicCapture,
    selectMic,
    selectThemInput,
  };
}
