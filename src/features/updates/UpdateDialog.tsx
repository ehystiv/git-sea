import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { commands } from "../../lib/bindings";
import { useT } from "../../lib/i18n";
import dialog from "../settings/SettingsDialog.module.css";
import { downloadFraction } from "./progress";
import { RELEASES_URL, useUpdates } from "./updatesStore";
import styles from "./UpdateDialog.module.css";

/** The version running now; null outside the app (dev pages). */
export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);
  return version;
}

/** What an available update brings, with its download and the restart after it. */
export function UpdateDialog() {
  const open = useUpdates((s) => s.open);
  const setOpen = useUpdates((s) => s.setOpen);
  if (!open) return null;
  return <Dialog onClose={() => setOpen(false)} />;
}

function Dialog({ onClose }: { onClose: () => void }) {
  const m = useT();
  const status = useUpdates((s) => s.status);
  const install = useUpdates((s) => s.install);
  const restart = useUpdates((s) => s.restart);
  const current = useAppVersion();
  const busy = status.kind === "downloading";

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || busy) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, busy]);

  const version = status.kind === "available" || status.kind === "downloading" || status.kind === "installed" ? status.version : null;
  const fraction = status.kind === "downloading" ? downloadFraction(status.download) : null;

  return (
    <div className={dialog.backdrop} onMouseDown={busy ? undefined : onClose}>
      <div className={dialog.dialog} role="dialog" aria-modal="true" aria-labelledby="update-title" onMouseDown={(e) => e.stopPropagation()}>
        <header className={dialog.head}>
          <h2 id="update-title">{version ? m.updates.title(version) : m.updates.section}</h2>
          {!busy && (
            <button type="button" className={dialog.close} aria-label={m.updates.close} title={m.updates.close} onClick={onClose}>
              ×
            </button>
          )}
        </header>

        {current && version && <p className={dialog.hint}>{m.updates.current(current)}</p>}

        {status.kind === "available" && <div className={`${styles.notes} selectable`}>{status.notes || m.updates.noNotes}</div>}

        {status.kind === "downloading" && (
          <div className={styles.progress}>
            <div className={styles.track}>
              <div className={`${styles.bar} ${fraction === null ? styles.indeterminate : ""}`} style={fraction === null ? undefined : { width: `${fraction * 100}%` }} />
            </div>
            <span>{fraction === null ? m.updates.downloading : m.updates.downloaded(Math.round(fraction * 100))}</span>
          </div>
        )}

        {status.kind === "installed" && <p className={styles.message}>{m.updates.installed}</p>}

        {status.kind === "error" && (
          <p className={styles.error} title={status.message}>
            {status.during === "install" ? m.updates.failed : m.updates.checkFailed}
          </p>
        )}

        <footer className={styles.actions}>
          {status.kind === "error" && (
            <button type="button" className={dialog.button} onClick={() => void commands.openUrl(RELEASES_URL)}>
              {m.updates.openReleases}
            </button>
          )}
          {status.kind === "available" && (
            <>
              <button type="button" className={dialog.button} onClick={onClose}>
                {m.updates.later}
              </button>
              <button type="button" className={`${dialog.button} ${styles.primary}`} onClick={() => void install()} autoFocus>
                {m.updates.install}
              </button>
            </>
          )}
          {status.kind === "installed" && (
            <button type="button" className={`${dialog.button} ${styles.primary}`} onClick={() => void restart()} autoFocus>
              {m.updates.restart}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
