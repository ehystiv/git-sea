import { describe, expect, it } from "vitest";
import { languageOf, parseChoice, resolveLanguage } from "./language";

describe("languageOf", () => {
  it("recognises Italian in any of its forms", () => {
    for (const locale of ["it", "it-IT", "it_CH", "IT-it", " it-IT "]) expect(languageOf(locale)).toBe("it");
  });

  it("falls back to English for every other language, or none", () => {
    for (const locale of ["en-US", "en", "de-DE", "fr", "", null, undefined]) expect(languageOf(locale)).toBe("en");
  });
});

describe("resolveLanguage", () => {
  it("follows the system only when asked to", () => {
    expect(resolveLanguage("system", "it-IT")).toBe("it");
    expect(resolveLanguage("system", "es-ES")).toBe("en");
    expect(resolveLanguage("en", "it-IT")).toBe("en");
    expect(resolveLanguage("it", "en-US")).toBe("it");
  });
});

describe("parseChoice", () => {
  it("keeps known choices and follows the system otherwise", () => {
    expect(parseChoice("it")).toBe("it");
    expect(parseChoice("en")).toBe("en");
    expect(parseChoice("system")).toBe("system");
    expect(parseChoice("fr")).toBe("system");
    expect(parseChoice(undefined)).toBe("system");
  });
});
