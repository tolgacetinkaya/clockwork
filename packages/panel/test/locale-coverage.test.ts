import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { locales } from "../client/i18n.js";
import { shellMessages } from "../client/locales/shell.js";
import { screensMessages } from "../client/locales/screens.js";
import { petMessages } from "../client/locales/pet.js";
import { questMessages } from "../client/locales/quest.js";

// A new t("...") without five translations must not silently ship English fallback.
describe("interface catalog coverage", () => {
  it("covers every literal message used by the client", () => {
    const root = fileURLToPath(new URL("../client/", import.meta.url));
    const missing: string[] = [];
    for (const file of readdirSync(root).filter((name) => /\.tsx?$/.test(name))) {
      const source = ts.createSourceFile(file, readFileSync(`${root}/${file}`, "utf8"), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t") {
          const key = node.arguments[0];
          if (key && ts.isStringLiteral(key)) {
            for (const locale of locales.filter((locale) => locale !== "en")) {
              if (![shellMessages, screensMessages, petMessages, questMessages].some((catalog) => Object.hasOwn(catalog[locale], key.text))) missing.push(`${file}:${locale}:${key.text}`);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(missing).toEqual([]);
  });
});
