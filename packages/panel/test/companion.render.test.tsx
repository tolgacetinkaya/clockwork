import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { Companion } from "../client/companion.js";
import { petMessages } from "../client/locales/pet.js";
import { petVariants, companionMessages } from "../client/companion-state.js";
describe("companion interface", () => {
    it("renders Piko in a document-flow dock with keyboard controls and no unsolicited announcement", () => {
        const html = renderToStaticMarkup(createElement(Companion));
        expect(html).toContain('/assets/arcade/puffin.png');
        expect(html).toContain('Piko');
        expect(html).toContain('aria-expanded="false"');
        expect(html).toContain('aria-live="polite"></span>');
        expect(html).toContain('<img');
    });
    it("translates all state messages in every supported non-English locale", () => {
        for (const catalog of Object.values(petMessages)) {
            for (const message of Object.values(companionMessages))
                expect(catalog[message]).toBeTruthy();
            for (const variant of petVariants) expect(catalog[variant.name]).toBeTruthy();
            for (const value of Object.values(catalog))
                expect(value).toBeTruthy();
        }
    });
});
