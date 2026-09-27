import { createContext, useContext, type ReactNode } from 'react';
import type { UiLang } from '../shared/protocol';
import { en } from './locales/en';
import { zh, type Dict } from './locales/zh';

export type { Dict };

/**
 * UI language dictionaries (R: 界面语言): src/locales/zh.ts and en.ts. Typed
 * nested objects instead of string keys: `en` is constrained to `typeof zh`,
 * so a missing translation is a compile error. Interpolated strings are
 * plain functions.
 *
 * This only covers the RENDERER chrome. It deliberately does NOT touch:
 *  - LLM prompts (electron/llm/prompts.ts; answers are always English)
 *  - deep engine diagnostics (they surface verbatim from the ASR/sidecar layer)
 */
const dicts: Record<UiLang, Dict> = { zh, en };

export function getDict(lang: UiLang | undefined): Dict {
  return dicts[lang ?? 'zh'];
}

const I18nContext = createContext<Dict>(zh);

export function I18nProvider({ lang, children }: { lang: UiLang | undefined; children: ReactNode }) {
  return <I18nContext.Provider value={getDict(lang)}>{children}</I18nContext.Provider>;
}

/** current UI dictionary; components read `t.section.key` (typed, no misses) */
export function useT(): Dict {
  return useContext(I18nContext);
}
