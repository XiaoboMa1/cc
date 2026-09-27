/**
 * ASR worker lifecycle (start / restart from the current settings) and the
 * audio IPC feeding it: PCM frames, cached-state replay, event forwarding.
 */
import { app, desktopCapturer, ipcMain, session } from 'electron';
import { join } from 'path';
import { captureKindForPlatform, whisperExecutionProvidersForPlatform } from '../shared/platform';
import { IPC, type AsrEvent } from '../shared/protocol';
import { T, type AppContext } from './appContext';
import type { AsrHostOptions } from './asrHost';
import { recordDiagnosticError } from './diagnostics';
import { parseLocalWsPort } from './funasrSidecar';
import { getResourceRoot } from './resourcePaths';

const MODEL_ID = 'onnx-community/whisper-large-v3-turbo-ONNX';

/** start the ASR worker; a local ws:// realtime backend auto-spawns the
 * python sidecar first (selecting the preset is all the user does) */
export async function startAsr(ctx: AppContext): Promise<void> {
  const { settings } = ctx;
  const a = settings.data.asr;
  const backend = a.backend ?? 'local';
  // each backend has its own config slot so switching never clobbers the others
  let cloud: AsrHostOptions['cloud'];
  if (backend === 'local-realtime') {
    // fixed localhost sidecar (auto-spawned); only the model is a choice
    cloud = {
      baseUrl: 'ws://127.0.0.1:10097',
      model: a.localRealtime?.model ?? 'fun-asr-nano',
      apiKey: '',
    };
  } else if (backend === 'cloud-realtime') {
    const rtKey = settings.getRealtimeAsrApiKey() ?? '';
    if (a.realtime?.baseUrl && a.realtime?.model && rtKey) {
      cloud = { baseUrl: a.realtime.baseUrl, model: a.realtime.model, apiKey: rtKey };
    }
  } else if (a.cloud?.baseUrl && a.cloud?.model && settings.getCloudAsrApiKey()) {
    cloud = { baseUrl: a.cloud.baseUrl, model: a.cloud.model, apiKey: settings.getCloudAsrApiKey()! };
  }

  const realtime = backend === 'local-realtime' || backend === 'cloud-realtime';
  const port = realtime ? parseLocalWsPort(cloud?.baseUrl) : null;
  if (port) {
    try {
      // NOT app.getAppPath(): packaged that resolves inside app.asar, which
      // python cannot read and the OS cannot use as a spawn cwd
      await ctx.sidecar.ensureRunning(port, getResourceRoot(), cloud?.model);
      console.log(`[sidecar] local ASR ready on :${port}`);
    } catch (e) {
      const message = T(ctx).sidecarFail((e as Error).message);
      console.error(`[sidecar] ${message}`);
      recordDiagnosticError('sidecar', (e as Error).message);
      ctx.win?.webContents.send(IPC.asrEvent, { kind: 'error', message, fatal: true });
      return;
    }
  } else {
    await ctx.sidecar.stop(); // switched away from local — reclaim its RAM/VRAM
  }
  ctx.asr.start({
    // the worker treats both realtime flavors identically (same WS engine)
    backend: backend === 'local-realtime' ? 'cloud-realtime' : backend,
    modelsDir: a.modelsDir ?? join(app.getPath('userData'), 'models'),
    modelId: MODEL_ID,
    ep: whisperExecutionProvidersForPlatform(process.platform),
    language: a.language,
    cloud,
  });
}

/** rebuild the worker with the new engine (backend / endpoint changed) */
export async function restartAsr(ctx: AppContext): Promise<void> {
  await ctx.asr.stop();
  await startAsr(ctx);
}

export function registerAsrIpc(ctx: AppContext): void {
  const { asr } = ctx;

  // Electron's `audio: loopback` display-media source is Windows-only.
  // macOS/Linux use a selectable ordinary input in the renderer instead.
  if (captureKindForPlatform(process.platform) === 'loopback') {
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
        .catch((e) => {
          console.error('[main] display media handler failed:', e);
          callback({});
        });
    });
  }

  ipcMain.on(IPC.capturePcm, (_e, buf: ArrayBuffer, captureTs: number, channel: 'them' | 'me') => {
    asr.sendPcm(buf, captureTs, channel === 'me' ? 'me' : 'them');
  });

  // pull-based replay: renderer asks after subscribing, so instant-ready
  // cloud engines can't race the subscription (stuck "模型加载中" bug)
  ipcMain.handle(IPC.asrReplay, () => ({ ready: asr.lastReady, status: asr.lastStatus }));

  asr.onEvent((ev: AsrEvent) => {
    if (ev.kind === 'segment') {
      const e2e = ev.timings.inferEndTs - ev.timings.speechEndTs;
      console.log(`[asr] #${ev.id} (${ev.lang ?? '?'}, ${ev.audioMs}ms audio, e2e ${e2e}ms) ${ev.text}`);
    } else if (ev.kind === 'ready') {
      console.log(`[asr] ready ep=${ev.ep} load=${ev.loadMs}ms warm=${ev.warmMs}ms gpuSuspect=${ev.gpuSuspect}`);
      if (process.env.MC_E2E_QUIT_ON_ASR_READY === '1') {
        setTimeout(() => app.quit(), 250);
      }
    } else if (ev.kind === 'error') {
      console.error(`[asr] error (fatal=${ev.fatal}): ${ev.message}`);
      if (ev.fatal) {
        // only fatal events belong in the support report — a transient
        // per-segment failure would flood the 50-entry buffer
        recordDiagnosticError('asr', ev.message);
        // engine diagnostics are deliberately English (they end up in logs
        // and in the diagnostics report); the sentence AROUND them is the
        // part the user reads, so it gets localized here
        ctx.win?.webContents.send(IPC.asrEvent, { ...ev, message: T(ctx).asrEngineFail(ev.message) });
        return;
      }
    } else if (ev.kind === 'status') {
      console.log(`[asr] status=${ev.state} queued=${ev.queuedSegments}`);
    }
    ctx.win?.webContents.send(IPC.asrEvent, ev);
  });
}
