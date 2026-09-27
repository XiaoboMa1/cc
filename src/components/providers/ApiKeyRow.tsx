import { useState } from 'react';
import type { ProviderTestResult, PublicSettings } from '../../../shared/protocol';
import { PROVIDER_HELP, findPresetByEndpoint } from '../../../shared/providerCatalog';
import { isTestableTarget, type EndpointTarget } from '../../../shared/providerTestRequests';
import { sanitizeApiKeyInput } from '../../../shared/keyInput';
import { useT } from '../../i18n';
import { ConnectionResult } from './ConnectionResult';
import { connectionResultCopy, lastTestText } from './copy';

/**
 * One API-key slot in the settings panel. Keys are write-only: the renderer
 * never sees a stored key, only whether one exists plus its last-4 hint.
 * Three outcomes feed the save patch — leave alone (undefined), replace (the
 * new plaintext), delete (`''`, which SettingsStore.applyPatch treats as
 * "clear this slot").
 */
export function useKeySlot() {
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return {
    value,
    setValue,
    editing,
    setEditing,
    pendingDelete,
    setPendingDelete,
    confirming,
    setConfirming,
    reset: (): void => {
      setValue('');
      setEditing(false);
      setPendingDelete(false);
      setConfirming(false);
    },
    /** the `apiKey` field for the settings patch, or undefined to keep it */
    patchValue: (): string | undefined => (pendingDelete ? '' : sanitizeApiKeyInput(value).value || undefined),
  };
}

export type KeySlot = ReturnType<typeof useKeySlot>;

/** in-flight / finished connection test for one provider slot */
export interface SlotTest {
  testing: boolean;
  result?: ProviderTestResult;
  at?: number;
  /** the IPC itself failed (provider failures arrive as a result, not a throw) */
  error?: string;
  /** the verdict belongs to a key that is typed but not saved yet */
  candidate?: boolean;
}

/** key status / entry, 测试连接, and the verdict for one credential slot */
export function ApiKeyRow({
  label,
  keySlot,
  settings,
  target,
  test,
  anyTesting,
  onTest,
}: {
  label: string;
  keySlot: KeySlot;
  /** live secret-free snapshot: 已配置 flag, last-4 hint, last verdict */
  settings: PublicSettings;
  /** where 测试连接 points; target.slot picks the stored key */
  target: EndpointTarget;
  test: SlotTest | undefined;
  /** one test at a time across the whole panel */
  anyTesting: boolean;
  /** run a test with the typed key ('' = the stored one) */
  onTest: (candidate: string) => void;
}) {
  const t = useT();
  const pub =
    target.slot === 'llm'
      ? settings.llm
      : target.slot === 'vision'
        ? settings.vision
        : target.slot === 'asr-cloud'
          ? settings.asr.cloud
          : settings.asr.realtime;
  const { apiKeySet, apiKeyHint } = pub;
  const candidate = sanitizeApiKeyInput(keySlot.value).value;
  const canTest = isTestableTarget(target) && !keySlot.pendingDelete && (candidate !== '' || apiKeySet);
  // the provider's own key page, for the failure path
  const keyUrl =
    findPresetByEndpoint(target.baseUrl, target.model, target.capability)?.help.keyUrl ??
    PROVIDER_HELP[target.providerId].keyUrl;

  return (
    <div className="settings-row">
      <label>{label}</label>
      {apiKeySet && !keySlot.editing && !keySlot.pendingDelete ? (
        <div className="key-status">
          <span className="tag tag-ok">{t.settings.keyConfigured}</span>
          {apiKeyHint && <span className="key-mask">{`••••${apiKeyHint}`}</span>}
          <button className="btn btn-sm" onClick={() => keySlot.setEditing(true)}>
            {t.settings.keyReplace}
          </button>
          {keySlot.confirming ? (
            <>
              <span className="settings-inline-hint">{t.settings.keyDeleteConfirm}</span>
              <button
                className="btn btn-sm"
                onClick={() => {
                  keySlot.setPendingDelete(true);
                  keySlot.setConfirming(false);
                }}
              >
                {t.settings.keyDeleteYes}
              </button>
              <button className="btn btn-sm" onClick={() => keySlot.setConfirming(false)}>
                {t.settings.keyDeleteNo}
              </button>
            </>
          ) : (
            <button className="btn btn-sm" onClick={() => keySlot.setConfirming(true)}>
              {t.settings.keyDelete}
            </button>
          )}
        </div>
      ) : keySlot.pendingDelete ? (
        <div className="key-status">
          <span className="tag tag-err">{t.settings.keyPendingDelete}</span>
          <button className="btn btn-sm" onClick={keySlot.reset}>
            {t.settings.keyUndoDelete}
          </button>
        </div>
      ) : (
        <>
          <input
            type="password"
            value={keySlot.value}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => keySlot.setValue(e.target.value)}
            placeholder={apiKeySet ? t.settings.keyNewPlaceholder : 'sk-…'}
          />
          <span className="settings-inline-hint">
            {apiKeySet ? t.settings.keyKeepPlaceholder : t.settings.keyMissing} · {t.settings.keySanitizedHint}
          </span>
        </>
      )}

      <div className="key-status">
        <button
          className="btn btn-sm"
          disabled={!canTest || anyTesting}
          title={canTest ? undefined : t.settings.testNoKey}
          onClick={() => onTest(candidate)}
        >
          {test?.testing ? t.settings.testing : t.settings.testConnection}
        </button>
        <span className="settings-inline-hint">{lastTestText(t, pub.verification)}</span>
      </div>

      <ConnectionResult
        copy={connectionResultCopy(t)}
        result={test?.result ?? null}
        testing={test?.testing}
        message={test?.result ? (t.uiLang === 'zh' ? test.result.messageZh : test.result.messageEn) : undefined}
        hint={test?.result ? t.settings.testHints[test.result.code] : undefined}
        at={test?.at}
      >
        {keyUrl && (
          <button className="btn btn-sm" onClick={() => void window.mc.openExternal(keyUrl)}>
            {t.settings.testOpenKeyPage}
          </button>
        )}
      </ConnectionResult>
      {test?.result?.ok && test.candidate && (
        <span className="settings-inline-hint">{t.settings.testCandidateOk}</span>
      )}
      {test?.error && <div className="settings-warn">{test.error}</div>}
    </div>
  );
}
