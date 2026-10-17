import type { Language } from "../bindings";

export type { Language };

/** What the user picked in the settings: follow the system, or a fixed language. */
export type LanguageChoice = "system" | Language;

export const LANGUAGE_CHOICES: readonly LanguageChoice[] = ["system", "en", "it"];

/** The locale `Intl` formats dates and numbers with, for each language. */
export const INTL_LOCALE: Record<Language, string> = { en: "en-US", it: "it-IT" };

/** The UI language for a system locale ("it-IT", "it_CH", "en"): Italian for Italian, English otherwise. */
export function languageOf(locale: string | null | undefined): Language {
  return locale?.trim().toLowerCase().split(/[-_]/)[0] === "it" ? "it" : "en";
}

export function resolveLanguage(choice: LanguageChoice, systemLocale: string | null | undefined): Language {
  return choice === "system" ? languageOf(systemLocale) : choice;
}

/** Anything that is not a known choice (a stale or hand-edited stored value) follows the system. */
export function parseChoice(value: unknown): LanguageChoice {
  return LANGUAGE_CHOICES.find((choice) => choice === value) ?? "system";
}
