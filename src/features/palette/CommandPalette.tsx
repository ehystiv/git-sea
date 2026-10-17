import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import { Kbd } from "../../components/Kbd/Kbd";
import { useT } from "../../lib/i18n";
import { hasModKey } from "../../lib/platform";
import { usePalette } from "./paletteStore";
import { groupCommands, rankCommands, type PaletteCommand } from "./rank";
import styles from "./CommandPalette.module.css";

/** ⌘K: every action of the window and of the active repository, plus its refs and commits. */
export function CommandPalette() {
  const open = usePalette((s) => s.open);
  const setOpen = usePalette((s) => s.setOpen);

  // ⌘K (Ctrl+K on Linux) opens and closes it from anywhere, text fields included.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (hasModKey(event) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(!usePalette.getState().open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setOpen]);

  if (!open) return null;
  return <PaletteDialog onClose={() => setOpen(false)} />;
}

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const m = useT();
  const sources = usePalette((s) => s.sources);
  const [query, setQuery] = useState("");
  const [value, setValue] = useState("");

  const results = useMemo(() => {
    const all = Object.values(sources);
    const ranked = rankCommands(
      all.flatMap((s) => s.commands),
      query,
    );
    const extra = query.trim() === "" ? [] : all.flatMap((s) => s.search?.(query) ?? []);
    return [...ranked, ...extra];
  }, [sources, query]);
  const groups = useMemo(() => groupCommands(results), [results]);

  // A new query starts again from the best result; a source updating meanwhile keeps the choice.
  const firstId = results[0]?.id ?? "";
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  if (lastQuery !== query) {
    setLastQuery(query);
    setValue(firstId);
  }

  function run(command: PaletteCommand) {
    onClose();
    // After the dialog is gone, so focus and key handlers are back where the command expects them.
    requestAnimationFrame(() => command.run());
  }

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={m.palette.dialog} onMouseDown={(e) => e.stopPropagation()}>
        <Command
          label={m.palette.dialog}
          shouldFilter={false}
          loop
          value={value}
          onValueChange={setValue}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
        >
          <div className={styles.inputRow}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <Command.Input autoFocus value={query} onValueChange={setQuery} placeholder={m.palette.placeholder} className={styles.input} />
            <Kbd>esc</Kbd>
          </div>
          <Command.List className={styles.list}>
            <Command.Empty className={styles.empty}>{m.palette.empty}</Command.Empty>
            {groups.map(({ group, commands }) => (
              <Command.Group key={group} heading={group} className={styles.group}>
                {commands.map((command) => (
                  <Command.Item key={command.id} value={command.id} onSelect={() => run(command)} className={styles.item}>
                    <span className={styles.title}>{command.title}</span>
                    {command.detail && <span className={styles.detail}>{command.detail}</span>}
                    {command.shortcut && <Kbd>{command.shortcut}</Kbd>}
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
