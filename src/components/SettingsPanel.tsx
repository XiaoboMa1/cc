import { useEffect, useState } from 'react';
import {
  HOTKEY_FIELDS,
  type AsrLanguage,
  type FontScale,
  type HotkeySettings,
  type ProviderSlot,
  type PublicSettings,
  type ThemeMode,
  type UiLang,
} from '../../shared/protocol';
import {
  LOCAL_REALTIME_MODELS,
  findPresetById,
  findPresetByEndpoint,
  presetsForCapability,
  providerIdForEndpoint,
  type ProviderCapability,
  type ProviderPreset,
} from '../../shared/providerCatalog';
import { candidateKeyTest, storedKeyTest, type EndpointTarget } from '../../shared/providerTestRequests';
import { listMics } from '../audio/micCapture';
import { useT } from '../i18n';
import { ApiKeyRow, useKeySlot, type KeySlot, type SlotTest } from './providers/ApiKeyRow';

type AsrBackend = 'local' | 'cloud' | 'cloud-realtime' | 'local-realtime';

/**
 * BYOK settings (R7). Reorganised in Phase 2 into 常用 / 高级 (SPEC §G) and
 * fed by shared/providerCatalog.ts instead of the local preset constants that
 * used to live here — the wizard and this panel now offer exactly the same
 * providers, selected by stable preset id rather than by URL matching.
 * baseUrl/model keep being stored in settings for compatibility; providerId is
 * derived from them at save time.
 */
export function SettingsPanel({
  settings,
  onSaved,
  onClose,
  onRerunWizard,
  onOpenDiagnostics,
  onOpenHelp,
}: {
  settings: PublicSettings;
  onSaved: (s: PublicSettings) => void;
  onClose: () => void;
  /** opens the first-run wizard again (main window stays alive) */
  onRerunWizard?: () => void;
  /** 高级 entry into the local support report */
  onOpenDiagnostics?: () => void;
  /** in-app help center (also reachable from the tray) */
  onOpenHelp?: () => void;
}) {
  const t = useT();
  const [baseUrl, setBaseUrl] = useState(settings.llm.baseUrl);
  const [model, setModel] = useState(settings.llm.model);
  const [language, setLanguage] = useState<AsrLanguage>(settings.asr.language);
  const [hotkeys, setHotkeys] = useState<Record<string, string>>(() =>
    Object.fromEntries(HOTKEY_FIELDS.map((k) => [k, settings.ui[k]])),
  );
  const [visionBaseUrl, setVisionBaseUrl] = useState(settings.vision.baseUrl ?? '');
  const [visionModel, setVisionModel] = useState(settings.vision.model ?? '');
  const [visionProxy, setVisionProxy] = useState(settings.vision.proxyUrl ?? '');
  const [asrBackend, setAsrBackend] = useState<AsrBackend>(settings.asr.backend);
  const [cloudBaseUrl, setCloudBaseUrl] = useState(settings.asr.cloud.baseUrl ?? '');
  const [cloudModel, setCloudModel] = useState(settings.asr.cloud.model ?? '');
  const [rtBaseUrl, setRtBaseUrl] = useState(settings.asr.realtime.baseUrl ?? '');
  const [rtModel, setRtModel] = useState(settings.asr.realtime.model ?? '');
  const [rtLocalModel, setRtLocalModel] = useState(
    settings.asr.localRealtime.model ?? 'fun-asr-nano',
  );
  const [autoLaunch, setAutoLaunch] = useState(settings.ui.autoLaunch);
  const [fontScale, setFontScale] = useState<FontScale>(settings.ui.fontScale ?? 'medium');
  const [theme, setTheme] = useState<ThemeMode>(settings.ui.theme ?? 'dark');
  const [uiLang, setUiLang] = useState<UiLang>(settings.ui.lang);
  const [themDeviceId, setThemDeviceId] = useState(settings.audio.themDeviceId ?? '');
  const [micDeviceId, setMicDeviceId] = useState(settings.audio.micDeviceId ?? '');
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [saving, setSaving] = useState(false);
  /** weak-crypto confirmation is pending; nothing has been sent to main yet */
  const [confirmWeak, setConfirmWeak] = useState(false);

  const llmKey = useKeySlot();
  const visionKey = useKeySlot();
  const cloudKey = useKeySlot();
  const rtKey = useKeySlot();

  /**
   * Live secret-free snapshot. The props seed the form once (uncontrolled by
   * design: the panel is a draft the user commits with 保存), but 已配置 flags
   * and connection-test verdicts must reflect what the main process just
   * recorded — a test writes `verification` through a dedicated store write.
   */
  const [live, setLive] = useState<PublicSettings>(settings);
  const [tests, setTests] = useState<Partial<Record<ProviderSlot, SlotTest>>>({});
  const anyTesting = Object.values(tests).some((s) => s?.testing);

  useEffect(() => {
    void listMics()
      .then(setDevices)
      .catch(() => setDevices([]));
  }, []);

  /**
   * One real provider round-trip on an explicit click. A key typed above wins
   * over the stored one — that is the 更换 Key flow's whole question — and the
   * candidate is NOT saved by the test: 保存 still commits the form.
   */
  const runSlotTest = async (slot: ProviderSlot, target: EndpointTarget, candidate: string) => {
    setTests((s) => ({ ...s, [slot]: { testing: true, candidate: candidate !== '' } }));
    try {
      const result = await window.mc.providerTest(
        candidate ? candidateKeyTest(target, candidate) : storedKeyTest(target),
      );
      setTests((s) => ({
        ...s,
        [slot]: { testing: false, result, at: Date.now(), candidate: candidate !== '' },
      }));
    } catch (e) {
      setTests((s) => ({
        ...s,
        [slot]: { testing: false, error: t.settings.testCrashed((e as Error).message) },
      }));
    }
    try {
      // main recorded the verdict into the slot — re-read so 上次测试… is current
      setLive(await window.mc.getSettings());
    } catch {
      /* the verdict is already on screen; a stale snapshot is not worth failing */
    }
  };

  /** preset display name in the current UI language */
  const presetName = (p: ProviderPreset): string => (t.uiLang === 'zh' ? p.nameZh : p.nameEn);

  /** pre-flight: ask before the plaintext leaves the renderer, so 「返回」
   * really means the key was never persisted. Only a save that would persist
   * a NEW plaintext key asks: a deletion is `''`, which writes no secret. */
  const requestSave = () => {
    const savesAKey = [llmKey, visionKey, cloudKey, rtKey].some((s) => !!s.patchValue());
    if (settings.weakCrypto && savesAKey) {
      setConfirmWeak(true);
      return;
    }
    void save();
  };

  const save = async () => {
    setConfirmWeak(false);
    setSaving(true);
    try {
      const llmApiKey = llmKey.patchValue();
      const visionApiKey = visionKey.patchValue();
      const cloudApiKey = cloudKey.patchValue();
      const rtApiKey = rtKey.patchValue();
      const next = await window.mc.setSettings({
        llm: {
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          providerId: providerIdForEndpoint(baseUrl.trim(), model.trim(), 'text-llm'),
          ...(llmApiKey !== undefined ? { apiKey: llmApiKey } : {}),
        },
        vision: {
          baseUrl: visionBaseUrl.trim(),
          model: visionModel.trim(),
          proxyUrl: visionProxy.trim(),
          providerId: providerIdForEndpoint(visionBaseUrl.trim(), visionModel.trim(), 'vision'),
          ...(visionApiKey !== undefined ? { apiKey: visionApiKey } : {}),
        },
        asr: {
          language,
          backend: asrBackend,
          // local backends have no cloud provider; leave the stored value alone
          ...(asrBackend === 'cloud-realtime'
            ? {
                providerId: providerIdForEndpoint(
                  rtBaseUrl.trim(),
                  rtModel.trim(),
                  'asr-realtime',
                ),
              }
            : asrBackend === 'cloud'
              ? {
                  providerId: providerIdForEndpoint(
                    cloudBaseUrl.trim(),
                    cloudModel.trim(),
                    'asr-segment',
                  ),
                }
              : {}),
          cloud: {
            baseUrl: cloudBaseUrl.trim(),
            model: cloudModel.trim(),
            ...(cloudApiKey !== undefined ? { apiKey: cloudApiKey } : {}),
          },
          realtime: {
            baseUrl: rtBaseUrl.trim(),
            model: rtModel.trim(),
            ...(rtApiKey !== undefined ? { apiKey: rtApiKey } : {}),
          },
          localRealtime: { model: rtLocalModel },
        },
        ui: {
          ...(Object.fromEntries(HOTKEY_FIELDS.map((k) => [k, hotkeys[k].trim()])) as Partial<HotkeySettings>),
          fontScale,
          theme,
          lang: uiLang,
          autoLaunch,
        },
        audio: {
          themDeviceId: themDeviceId || undefined,
          micDeviceId: micDeviceId || undefined,
        },
      });
      llmKey.reset();
      visionKey.reset();
      cloudKey.reset();
      rtKey.reset();
      onSaved(next);
    } finally {
      setSaving(false);
    }
  };

  /** provider dropdown driven by the catalog; the value is always the truth
   * derived from the stored baseUrl+model, so an unmatched pair reads 自定义 */
  const providerSelect = (
    capability: ProviderCapability,
    currentBaseUrl: string,
    currentModel: string,
    onPick: (p: ProviderPreset) => void,
  ) => {
    const presets = presetsForCapability(capability).filter((p) => p.baseUrl && p.model);
    const current = findPresetByEndpoint(currentBaseUrl, currentModel, capability);
    return (
      <select
        value={current?.id ?? ''}
        onChange={(e) => {
          const p = findPresetById(e.target.value);
          if (p) onPick(p);
        }}
      >
        {!current && <option value="">{t.settings.providerCustom}</option>}
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {presetName(p)}
          </option>
        ))}
      </select>
    );
  };

  /** one key row; its connection test points at the endpoint typed above */
  const keyRow = (
    label: string,
    keySlot: KeySlot,
    slot: ProviderSlot,
    capability: ProviderCapability,
    rowBaseUrl: string,
    rowModel: string,
    proxyUrl = '',
  ) => {
    const target: EndpointTarget = {
      capability,
      providerId: providerIdForEndpoint(rowBaseUrl.trim(), rowModel.trim(), capability),
      baseUrl: rowBaseUrl,
      model: rowModel,
      slot,
      ...(proxyUrl.trim() ? { proxyUrl: proxyUrl.trim() } : {}),
    };
    return (
      <ApiKeyRow
        label={label}
        keySlot={keySlot}
        settings={live}
        target={target}
        test={tests[slot]}
        anyTesting={anyTesting}
        onTest={(candidate) => void runSlotTest(slot, target, candidate)}
      />
    );
  };

  const asrSummary = (): string => {
    if (asrBackend === 'local') return t.settings.asrLocalWhisper;
    if (asrBackend === 'local-realtime') {
      const m = LOCAL_REALTIME_MODELS.find((x) => x.value === rtLocalModel);
      return m ? (t.uiLang === 'zh' ? m.nameZh : m.nameEn) : rtLocalModel;
    }
    const p =
      asrBackend === 'cloud-realtime'
        ? findPresetByEndpoint(rtBaseUrl, rtModel, 'asr-realtime')
        : findPresetByEndpoint(cloudBaseUrl, cloudModel, 'asr-segment');
    return p ? presetName(p) : t.settings.providerCustom;
  };

  const llmPreset = findPresetByEndpoint(baseUrl, model, 'text-llm');

  const deviceOptions = (
    <>
      <option value="">{t.settings.deviceDefault}</option>
      {devices.map((d) => (
        <option key={d.deviceId} value={d.deviceId}>
          {d.label || d.deviceId}
        </option>
      ))}
    </>
  );

  return (
    <div className="settings">
      {/* ---------------- 常用 ---------------- */}
      <div className="settings-section">{t.settings.commonSection}</div>
      <div className="settings-hint">
        {t.settings.planSection}: {t.settings.planAsr} — {asrSummary()} · {t.settings.planLlm} —{' '}
        {llmPreset ? presetName(llmPreset) : model || '—'}
      </div>
      {/* said once for the whole panel: every 测试连接 button below costs one
          minimal billable request, and tests only ever run on a click */}
      <div className="settings-hint">{t.settings.testFeeNote}</div>

      {window.mc.platform === 'darwin' && (
        <div className="settings-hint">{t.settings.macAudioHint}</div>
      )}
      <div className="settings-row">
        <label>{t.settings.asrBackend}</label>
        <select value={asrBackend} onChange={(e) => setAsrBackend(e.target.value as AsrBackend)}>
          <optgroup label={t.settings.asrLocalGroup}>
            <option value="local-realtime">{t.settings.asrLocalRealtime}</option>
            <option value="local">{t.settings.asrLocalWhisper}</option>
          </optgroup>
          <optgroup label={t.settings.asrCloudGroup}>
            <option value="cloud-realtime">{t.settings.asrCloudRealtime}</option>
            <option value="cloud">{t.settings.asrCloudSeg}</option>
          </optgroup>
        </select>
      </div>
      {asrBackend === 'local-realtime' && (
        <div className="settings-row">
          <label>{t.settings.localRtModel}</label>
          <select value={rtLocalModel} onChange={(e) => setRtLocalModel(e.target.value)}>
            {LOCAL_REALTIME_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {t.uiLang === 'zh' ? m.nameZh : m.nameEn}
              </option>
            ))}
          </select>
        </div>
      )}
      {asrBackend === 'cloud-realtime' && (
        <>
          <div className="settings-row">
            <label>{t.settings.providerPreset}</label>
            {providerSelect('asr-realtime', rtBaseUrl, rtModel, (p) => {
              setRtBaseUrl(p.baseUrl);
              setRtModel(p.model);
            })}
          </div>
          {keyRow(t.settings.rtApiKey, rtKey, 'asr-realtime', 'asr-realtime', rtBaseUrl, rtModel)}
        </>
      )}
      {asrBackend === 'cloud' && (
        <>
          <div className="settings-row">
            <label>{t.settings.providerPreset}</label>
            {providerSelect('asr-segment', cloudBaseUrl, cloudModel, (p) => {
              setCloudBaseUrl(p.baseUrl);
              setCloudModel(p.model);
            })}
          </div>
          {keyRow(t.settings.cloudApiKey, cloudKey, 'asr-cloud', 'asr-segment', cloudBaseUrl, cloudModel)}
        </>
      )}
      <div className="settings-row">
        <label>{t.settings.asrLanguage}</label>
        <select value={language} onChange={(e) => setLanguage(e.target.value as AsrLanguage)}>
          <option value="auto">{t.settings.asrLangAuto}</option>
          <option value="chinese">{t.settings.asrLangZh}</option>
          <option value="english">{t.settings.asrLangEn}</option>
        </select>
      </div>

      <div className="settings-row">
        <label>
          {t.settings.planLlm} · {t.settings.providerPreset}
        </label>
        {providerSelect('text-llm', baseUrl, model, (p) => {
          setBaseUrl(p.baseUrl);
          setModel(p.model);
        })}
      </div>
      {keyRow(t.settings.apiKey, llmKey, 'llm', 'text-llm', baseUrl, model)}
      <div className="settings-row">
        <label>{t.settings.uiLang}</label>
        <select value={uiLang} onChange={(e) => setUiLang(e.target.value as UiLang)}>
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </div>
      <div className="settings-row">
        <label>{t.settings.theme}</label>
        <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeMode)}>
          <option value="dark">{t.settings.themeDark}</option>
          <option value="light">{t.settings.themeLight}</option>
          <option value="system">{t.settings.themeSystem}</option>
        </select>
      </div>
      <div className="settings-row">
        <label>{t.settings.fontScaleLabel}</label>
        <select value={fontScale} onChange={(e) => setFontScale(e.target.value as FontScale)}>
          <option value="small">{t.settings.fontSmall}</option>
          <option value="medium">{t.settings.fontMedium}</option>
          <option value="large">{t.settings.fontLarge}</option>
        </select>
      </div>

      {HOTKEY_FIELDS.map((k) => (
        <div className="settings-row" key={k}>
          <label>{t.settings[k]}</label>
          <input
            value={hotkeys[k]}
            onChange={(e) => setHotkeys((h) => ({ ...h, [k]: e.target.value }))}
            spellCheck={false}
          />
        </div>
      ))}
      <div className="settings-hint">{t.settings.hotkeysHint}</div>
      <div className="settings-row">
        <label>{t.settings.autoLaunch}</label>
        <select
          value={autoLaunch ? 'on' : 'off'}
          onChange={(e) => setAutoLaunch(e.target.value === 'on')}
        >
          <option value="off">{t.settings.autoLaunchOff}</option>
          <option value="on">{t.settings.autoLaunchOn}</option>
        </select>
        <span className="settings-inline-hint">{t.settings.autoLaunchHint}</span>
      </div>

      <div className="settings-section">{t.settings.audioSection}</div>
      <div className="settings-row">
        <label>{t.settings.themDevice}</label>
        <select value={themDeviceId} onChange={(e) => setThemDeviceId(e.target.value)}>
          {deviceOptions}
        </select>
      </div>
      <div className="settings-row">
        <label>{t.settings.micDevice}</label>
        <select value={micDeviceId} onChange={(e) => setMicDeviceId(e.target.value)}>
          {deviceOptions}
        </select>
      </div>
      <div className="settings-hint">{t.settings.otherHint}</div>

      {onOpenHelp && (
        <div className="settings-row">
          <button className="btn" onClick={onOpenHelp}>
            {t.help.title}
          </button>
          <span className="settings-inline-hint">{t.settings.helpHint}</span>
        </div>
      )}

      {onRerunWizard && (
        <div className="settings-row">
          <button className="btn" onClick={onRerunWizard}>
            {t.settings.rerunWizard}
          </button>
          <span className="settings-inline-hint">{t.settings.rerunWizardHint}</span>
        </div>
      )}

      {/* ---------------- 高级 ---------------- */}
      <details className="settings-advanced">
        <summary>{t.settings.advancedSection}</summary>
        <div className="settings-hint">{t.settings.advancedHint}</div>

        {onOpenDiagnostics && (
          <div className="settings-row">
            <button className="btn" onClick={onOpenDiagnostics}>
              {t.diagnostics.title}
            </button>
            <span className="settings-inline-hint">{t.diagnostics.intro}</span>
          </div>
        )}

        <div className="settings-section">{t.settings.textSection}</div>
        <div className="settings-row">
          <label>{t.settings.baseUrl}</label>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false} />
        </div>
        <div className="settings-row">
          <label>{t.settings.model}</label>
          <input value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
        </div>

        <div className="settings-section">{t.settings.visionSection}</div>
        <div className="settings-hint">{t.settings.visionHint}</div>
        <div className="settings-row">
          <label>{t.settings.providerPreset}</label>
          {providerSelect('vision', visionBaseUrl, visionModel, (p) => {
            setVisionBaseUrl(p.baseUrl);
            setVisionModel(p.model);
            setVisionProxy(p.defaultProxyUrl ?? '');
          })}
        </div>
        <div className="settings-row">
          <label>{t.settings.visionBaseUrl}</label>
          <input
            value={visionBaseUrl}
            onChange={(e) => setVisionBaseUrl(e.target.value)}
            spellCheck={false}
            placeholder={t.settings.visionBaseUrlPlaceholder}
          />
        </div>
        <div className="settings-row">
          <label>{t.settings.visionModel}</label>
          <input
            value={visionModel}
            onChange={(e) => setVisionModel(e.target.value)}
            spellCheck={false}
          />
        </div>
        {keyRow(t.settings.visionApiKey, visionKey, 'vision', 'vision', visionBaseUrl, visionModel, visionProxy)}
        <div className="settings-row">
          <label>{t.settings.visionProxy}</label>
          <input
            value={visionProxy}
            onChange={(e) => setVisionProxy(e.target.value)}
            spellCheck={false}
            placeholder={t.settings.visionProxyPlaceholder}
          />
        </div>

        <div className="settings-section">{t.settings.asrSection}</div>
        <div className="settings-row">
          <label>{t.settings.rtBaseUrl}</label>
          <input value={rtBaseUrl} onChange={(e) => setRtBaseUrl(e.target.value)} spellCheck={false} />
        </div>
        <div className="settings-row">
          <label>{t.settings.rtModel}</label>
          <input value={rtModel} onChange={(e) => setRtModel(e.target.value)} spellCheck={false} />
        </div>
        <div className="settings-row">
          <label>{t.settings.cloudBaseUrl}</label>
          <input
            value={cloudBaseUrl}
            onChange={(e) => setCloudBaseUrl(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="settings-row">
          <label>{t.settings.cloudModel}</label>
          <input
            value={cloudModel}
            onChange={(e) => setCloudModel(e.target.value)}
            spellCheck={false}
          />
        </div>
      </details>

      {confirmWeak && (
        <div className="settings-warn">
          <div>{t.settings.weakCryptoWarning}</div>
          <div className="settings-actions" style={{ marginTop: 6 }}>
            <button className="btn btn-sm" onClick={() => setConfirmWeak(false)}>
              {t.settings.weakCryptoBack}
            </button>
            <button className="btn btn-sm" onClick={() => void save()}>
              {t.settings.weakCryptoContinue}
            </button>
          </div>
        </div>
      )}

      <div className="settings-actions">
        <button className="btn btn-primary" onClick={requestSave} disabled={saving}>
          {saving ? t.settings.saving : t.settings.save}
        </button>
        <button className="btn" onClick={onClose}>
          {t.settings.cancel}
        </button>
      </div>
    </div>
  );
}
