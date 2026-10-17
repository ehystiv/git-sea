import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { commands } from "../../lib/bindings";
import { formatBytes } from "../../lib/format";
import { LANGUAGE_CHOICES, useLanguage, useSystemLanguage, useT, type LanguageChoice } from "../../lib/i18n";
import { useTheme } from "../../lib/theme";
import { THEME_MODES, type ThemeMode } from "../../lib/themeLogic";
import { useSettings } from "./settingsStore";
import styles from "./SettingsDialog.module.css";

/** App settings: language and theme. Opened from the title bar, the native menu (⌘,) and the palette. */
export function SettingsDialog() {
  const open = useSettings((s) => s.open);
  const setOpen = useSettings((s) => s.setOpen);
  if (!open) return null;
  return <Dialog onClose={() => setOpen(false)} />;
}

function Dialog({ onClose }: { onClose: () => void }) {
  const m = useT();
  const choice = useLanguage((s) => s.choice);
  const setChoice = useLanguage((s) => s.setChoice);
  const system = useSystemLanguage();
  const themeMode = useTheme((s) => s.mode);
  const setTheme = useTheme((s) => s.setMode);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const languageLabel = (c: LanguageChoice) => (c === "system" ? m.language.system(m.language[system]) : m.language[c]);
  const themeLabel: Record<ThemeMode, string> = { system: m.settings.themeSystem, light: m.settings.themeLight, dark: m.settings.themeDark };

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(e) => e.stopPropagation()}>
        <header className={styles.head}>
          <h2 id="settings-title">{m.settings.title}</h2>
          <button type="button" className={styles.close} aria-label={m.settings.close} title={m.settings.close} onClick={onClose}>
            ×
          </button>
        </header>

        <section className={styles.row}>
          <h3 id="settings-language">{m.settings.language}</h3>
          <Segmented labelledBy="settings-language" options={LANGUAGE_CHOICES} value={choice} label={languageLabel} onChange={setChoice} autoFocus />
          <p className={styles.hint}>{m.settings.languageHint}</p>
        </section>

        <section className={styles.row}>
          <h3 id="settings-theme">{m.settings.theme}</h3>
          <Segmented labelledBy="settings-theme" options={THEME_MODES} value={themeMode} label={(mode) => themeLabel[mode]} onChange={setTheme} />
        </section>

        <CacheSection />
      </div>
    </div>
  );
}

/** How much the graph cache takes, with a button to empty it. */
function CacheSection() {
  const m = useT();
  const queryClient = useQueryClient();
  const usage = useQuery({ queryKey: ["cache-usage"], queryFn: () => commands.cacheUsage(), staleTime: 0, retry: false });
  const [cleared, setCleared] = useState(false);

  async function clear() {
    const result = await commands.clearCache().catch(() => null);
    if (result?.status === "ok") setCleared(true);
    await queryClient.invalidateQueries({ queryKey: ["cache-usage"] });
  }

  return (
    <section className={styles.row}>
      <h3>{m.settings.cache}</h3>
      <div className={styles.cache}>
        <span>{usage.data ? m.settings.cacheUsage(usage.data.files, formatBytes(usage.data.bytes ?? 0)) : "…"}</span>
        <button type="button" className={styles.button} disabled={!usage.data || usage.data.files === 0} onClick={() => void clear()}>
          {cleared && usage.data?.files === 0 ? m.settings.cleared : m.settings.clearCache}
        </button>
      </div>
      <p className={styles.hint}>{m.settings.cacheHint}</p>
    </section>
  );
}

function Segmented<T extends string>({
  labelledBy,
  options,
  value,
  label,
  onChange,
  autoFocus,
}: {
  labelledBy: string;
  options: readonly T[];
  value: T;
  label: (option: T) => string;
  onChange: (option: T) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className={styles.seg} role="radiogroup" aria-labelledby={labelledBy}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={option === value}
          className={option === value ? styles.on : undefined}
          autoFocus={autoFocus && option === value}
          onClick={() => onChange(option)}
        >
          {label(option)}
        </button>
      ))}
    </div>
  );
}
