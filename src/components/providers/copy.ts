/**
 * Adapter between the main-window dictionary and the shared ConnectionResult
 * component (the wizard has its own in src/onboarding/connectionCopy.ts —
 * neither renderer entry may import the other's dictionary).
 */
import type { ProviderVerification } from '../../../shared/protocol';
import type { Dict } from '../../i18n';
import type { ConnectionResultCopy } from './ConnectionResult';

/** the stored result of a slot's last connection test, as one line */
export function lastTestText(t: Dict, v: ProviderVerification | undefined): string {
  if (!v?.lastTestAt) return t.settings.testNever;
  const when = new Date(v.lastTestAt).toLocaleString(t.locale);
  return v.lastTestOk ? t.settings.testLastOk(when, v.latencyMs) : t.settings.testLastFail(when);
}

export function connectionResultCopy(t: Dict): ConnectionResultCopy {
  return {
    locale: t.locale,
    testing: t.settings.testing,
    success: t.settings.testSuccessTag,
    failed: t.settings.testFailedTag,
    hintLabel: t.settings.testHintLabel,
    retryableNote: t.settings.testRetryable,
    detailShow: t.settings.testDetailShow,
    detailHide: t.settings.testDetailHide,
    detailCode: t.settings.testDetailCode,
    detailRequestId: t.settings.testDetailRequestId,
    detailTime: t.settings.testDetailTime,
  };
}
