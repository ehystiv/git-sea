import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { commands } from "../bindings";
import { en, type Messages } from "./en";
import { it } from "./it";
import { INTL_LOCALE, languageOf, parseChoice, resolveLanguage, type Language, type LanguageChoice } from "./language";

export type { Messages };
export { LANGUAGE_CHOICES, type Language, type LanguageChoice } from "./language";

/** Fired on `window` after the language changed, for canvases that draw text. */
export const LANGUAGE_CHANGED = "git-sea:language-changed";

const MESSAGES: Record<Language, Messages> = { en, it };

interface LanguageStore {
  choice: LanguageChoice;
  /** The system locale as the backend reports it; until it answers, the webview's. */
  systemLocale: string | null;
  setChoice: (choice: LanguageChoice) => void;
  setSystemLocale: (locale: string | null) => void;
}

export const useLanguage = create<LanguageStore>()(
  persist(
    (set) => ({
      choice: "system",
      systemLocale: typeof navigator === "undefined" ? null : navigator.language,
      setChoice: (choice) => set({ choice }),
      setSystemLocale: (systemLocale) => set({ systemLocale }),
    }),
    {
      name: "git-sea:language",
      partialize: (s) => ({ choice: s.choice }),
      merge: (stored, current) => ({ ...current, choice: parseChoice((stored as Partial<LanguageStore> | null)?.choice) }),
    },
  ),
);

const languageOfState = (s: LanguageStore): Language => resolveLanguage(s.choice, s.systemLocale);

/** The language the UI is in right now. */
export function currentLanguage(): Language {
  return languageOfState(useLanguage.getState());
}

/** The texts in the current language, for code outside React (canvases, palette commands). */
export function t(): Messages {
  return MESSAGES[currentLanguage()];
}

/** The texts in the current language; the component re-renders when it changes. */
export function useT(): Messages {
  return MESSAGES[useLanguage(languageOfState)];
}

/** The language the system is in, as the UI would follow it: for the "System" choice in the settings. */
export function useSystemLanguage(): Language {
  return useLanguage((s) => languageOf(s.systemLocale));
}

/** The locale `Intl` formatters use for the current language. */
export function intlLocale(): string {
  return INTL_LOCALE[currentLanguage()];
}

function apply(language: Language): void {
  document.documentElement.lang = language;
  window.dispatchEvent(new Event(LANGUAGE_CHANGED));
  // The native menu and the backend's messages follow the UI. Outside Tauri there is no backend.
  if ("__TAURI_INTERNALS__" in window) void commands.setLanguage(language).catch(() => undefined);
}

/** Sets the document language, keeps the backend in step, and asks the backend for the system locale. Call once, before the first render. */
export function initLanguage(): void {
  let applied = currentLanguage();
  apply(applied);
  useLanguage.subscribe((state) => {
    const language = languageOfState(state);
    if (language === applied) return;
    applied = language;
    apply(language);
  });
  if ("__TAURI_INTERNALS__" in window) {
    commands
      .systemLocale()
      .then((locale) => {
        if (locale) useLanguage.getState().setSystemLocale(locale);
      })
      .catch(() => undefined);
  }
}

/** Re-runs `callback` whenever the language changes. */
export function useLanguageChanged(callback: () => void): void {
  useEffect(() => {
    window.addEventListener(LANGUAGE_CHANGED, callback);
    return () => window.removeEventListener(LANGUAGE_CHANGED, callback);
  }, [callback]);
}
