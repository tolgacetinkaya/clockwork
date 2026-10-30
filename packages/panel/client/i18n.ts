import { useSyncExternalStore } from "react";
import { shellMessages } from "./locales/shell.js";
import { screensMessages } from "./locales/screens.js";
import { petMessages } from "./locales/pet.js";
import { questMessages } from "./locales/quest.js";
import { watchdogMessages } from "./locales/watchdog.js";
import { modelMessages } from "./locales/models.js";
import { workflowMessages } from "./locales/workflow.js";

export const locales = ["en", "tr", "es", "de", "fr", "pt"] as const;
export type Locale = (typeof locales)[number];
export type Catalog = Record<Exclude<Locale, "en">, Record<string, string>>;
export const localeNames: Record<Locale, string> = {
  en: "English", tr: "Türkçe", es: "Español", de: "Deutsch", fr: "Français", pt: "Português (Brasil)",
};
export const intlLocale: Record<Locale, string> = { en: "en", tr: "tr", es: "es", de: "de", fr: "fr", pt: "pt-BR" };
export const localeStorageKey = "clockwork.locale.v1";
type Values = Record<string, string | number>;
// Keep shared translation helpers importable by the Node-only server/test project.
// These are the only browser capabilities this module needs.
interface LocaleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
interface BrowserEnvironment {
  window?: {
    localStorage?: LocaleStorage;
    navigator?: { languages?: readonly string[]; language?: string };
  };
  document?: { documentElement: { lang: string } };
}
const environment = (): BrowserEnvironment => globalThis as unknown as BrowserEnvironment;
export function resolveLocale(value: string | null | undefined): Locale | undefined {
  const base = value?.toLowerCase().split(/[-_]/)[0];
  return locales.find((candidate) => candidate === base);
}
export function selectInitialLocale(storage?: Pick<LocaleStorage, "getItem">, languages: readonly string[] = []): Locale {
  try {
    const saved = storage?.getItem(localeStorageKey);
    if (saved && locales.includes(saved as Locale)) return saved as Locale;
  } catch { /* Storage may be unavailable in private or embedded contexts. */ }
  for (const language of languages) {
    const locale = resolveLocale(language);
    if (locale) return locale;
  }
  return "en";
}
function browserLocale(): Locale {
  const browser = environment().window;
  if (!browser) return "en";
  let storage: LocaleStorage | undefined;
  try { storage = browser.localStorage; } catch { /* Use browser preferences. */ }
  const navigator = browser.navigator;
  return selectInitialLocale(storage, navigator?.languages ?? (navigator?.language ? [navigator.language] : []));
}
let currentLocale = browserLocale();
const listeners = new Set<() => void>();
export const getLocale = (): Locale => currentLocale;
export function setLocale(locale: Locale): void {
  if (!locales.includes(locale)) return;
  const changed = currentLocale !== locale;
  currentLocale = locale;
  const browser = environment();
  if (browser.document) browser.document.documentElement.lang = intlLocale[locale];
  try { browser.window?.localStorage?.setItem(localeStorageKey, locale); } catch { /* Language still works for this session. */ }
  if (changed) listeners.forEach((listener) => listener());
}
export function initializeLocale(): void { setLocale(currentLocale); }
const catalogs: Catalog[] = [shellMessages, screensMessages, petMessages, questMessages, workflowMessages, watchdogMessages, modelMessages];
export function translate(locale: Locale, message: string, values: Values = {}): string {
  const translated = locale === "en" ? message : catalogs.reduce<string | undefined>((found, catalog) => found ?? (Object.prototype.hasOwnProperty.call(catalog[locale], message) ? catalog[locale][message] : undefined), undefined) ?? message;
  return translated.replace(/\{([a-zA-Z0-9_]+)\}/g, (placeholder, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : placeholder);
}
export function t(message: string, values?: Values): string { return translate(currentLocale, message, values); }
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useI18n() {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale);
  return { locale, setLocale, t: (message: string, values?: Values) => translate(locale, message, values) };
}
