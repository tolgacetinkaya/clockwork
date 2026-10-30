import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  getLocale, intlLocale, localeStorageKey, locales, resolveLocale,
  selectInitialLocale, setLocale, t, translate, useI18n,
} from "../client/i18n.js";
import { shellMessages } from "../client/locales/shell.js";
import { screensMessages } from "../client/locales/screens.js";
import { petMessages } from "../client/locales/pet.js";
import { compact, number, time } from "../client/format.js";
import { Layout } from "../client/layout.js";
import { Status } from "../client/ui.js";

afterEach(() => { vi.unstubAllGlobals(); setLocale("en"); });

describe("locale selection", () => {
  it("uses a valid saved preference before browser languages", () => {
    expect(selectInitialLocale({ getItem: () => "tr" }, ["de-DE"])).toBe("tr");
    expect(selectInitialLocale({ getItem: () => "pt" }, ["en-US"])).toBe("pt");
  });
  it("ignores unsupported or malformed preferences and resolves browser regions", () => {
    expect(selectInitialLocale({ getItem: () => "{broken" }, ["ja", "pt-BR", "fr"])).toBe("pt");
    expect(selectInitialLocale({ getItem: () => "de-DE" }, ["es-MX"])).toBe("es");
    expect(selectInitialLocale(undefined, ["ja-JP"])).toBe("en");
    expect(resolveLocale("TR-tr")).toBe("tr");
    expect(resolveLocale("__proto__")).toBeUndefined();
  });
  it("works when reading storage is blocked", () => {
    expect(selectInitialLocale({ getItem() { throw new Error("blocked"); } }, ["fr-FR"])).toBe("fr");
  });
  it("persists changes and updates the document language, including pt-BR", () => {
    const setItem = vi.fn();
    const documentElement = { lang: "en" };
    vi.stubGlobal("window", { localStorage: { setItem } });
    vi.stubGlobal("document", { documentElement });
    setLocale("pt");
    expect(getLocale()).toBe("pt");
    expect(setItem).toHaveBeenCalledWith(localeStorageKey, "pt");
    expect(documentElement.lang).toBe("pt-BR");
  });
  it("keeps a working session locale when storage writes or access fail", () => {
    vi.stubGlobal("window", { get localStorage() { throw new Error("denied"); } });
    expect(() => setLocale("de")).not.toThrow();
    expect(getLocale()).toBe("de");
    expect(t("Language")).toBe("Sprache");
  });
});

describe("translation catalogs", () => {
  for (const [name, catalog] of Object.entries({ shellMessages, screensMessages, petMessages })) {
    it(`${name} has complete locale and placeholder parity`, () => {
      const keys = Object.keys(catalog.tr).sort();
      expect(keys.length).toBeGreaterThan(0);
      for (const locale of locales.filter((locale) => locale !== "en")) {
        expect(Object.keys(catalog[locale]).sort()).toEqual(keys);
        for (const key of keys) {
          const translated = catalog[locale][key]!;
          expect(translated.trim(), `${locale}: ${key}`).not.toBe("");
          expect([...translated.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort(), `${locale}: ${key}`)
            .toEqual([...key.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort());
        }
      }
    });
  }
  it("falls back to English and never reads inherited object properties", () => {
    expect(translate("tr", "A future message {count}", { count: 4 })).toBe("A future message 4");
    for (const key of ["__proto__", "constructor", "toString"]) expect(translate("fr", key)).toBe(key);
  });
  it("interpolates literal text without recursive replacement or HTML", () => {
    const text = '<img src=x onerror=alert(1)> $& {seq}';
    expect(translate("en", "Value: {value}; {missing}", { value: text })).toBe(`Value: ${text}; {missing}`);
    expect(translate("tr", "Request #{seq} queued for the orchestrator.", { seq: 0 })).toContain("#0");
    const markup = renderToStaticMarkup(createElement("span", null, translate("en", "{value}", { value: text })));
    expect(markup).toContain("&lt;img");
    expect(markup).not.toContain("<img");
  });
  it("exposes the selected locale through React and formats numbers and time with Intl", () => {
    function Probe() { const { t } = useI18n(); return createElement("span", null, t("Language")); }
    setLocale("fr");
    expect(renderToStaticMarkup(createElement(Probe))).toContain("Langue");
    expect(number(12345.6)).toBe(new Intl.NumberFormat("fr").format(12345.6));
    expect(compact(12345)).toBe(new Intl.NumberFormat("fr", { notation: "compact", maximumFractionDigits: 1 }).format(12345));
    const date = "2026-10-29T10:34:00Z";
    expect(time(date)).toBe(new Date(date).toLocaleTimeString(intlLocale.fr, { hour: "2-digit", minute: "2-digit", hour12: false }));
  });
});


describe("translated shell rendering", () => {
  it.each([
    ["en", "Overview", "Language", "In progress"],
    ["tr", "Genel bakış", "Dil", "Devam ediyor"],
    ["es", "Resumen", "Idioma", "En curso"],
    ["de", "Übersicht", "Sprache", "In Bearbeitung"],
    ["fr", "Vue d’ensemble", "Langue", "En cours"],
    ["pt", "Visão geral", "Idioma", "Em andamento"],
  ] as const)("renders navigation, language selection and statuses in %s", (locale, overview, language, status) => {
    setLocale(locale);
    const markup = renderToStaticMarkup(createElement(Layout, {
      disabled: true, controlBusy: false, changeControl: () => {},
      children: createElement(Status, { value: "running" }),
    }));
    expect(markup).toContain(overview);
    expect(markup).toContain(language);
    expect(markup).toContain(status);
    expect(markup.match(/<option /g)).toHaveLength(6);
    expect(markup.match(new RegExp('<option[^>]*value="' + locale + '"[^>]*>'))?.[0]).toContain('selected=""');
    expect(markup).toContain('lang="pt-BR"');
  });
});
