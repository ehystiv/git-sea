import type { ChangeStatus, FileChange } from "../../lib/bindings";
import { splitPath } from "../../lib/format";
import { useT } from "../../lib/i18n";
import styles from "./FileList.module.css";

const STATUS_LETTER: Record<ChangeStatus, string> = {
  Added: "A",
  Modified: "M",
  Deleted: "D",
  Renamed: "R",
  TypeChange: "T",
};

interface FileListProps {
  files: FileChange[];
  selectedPath: string | null;
  onSelect: (file: FileChange) => void;
  /** Shows the commits that changed a file; without it there is no history button. */
  onHistory?: (path: string) => void;
}

export function FileList({ files, selectedPath, onSelect, onHistory }: FileListProps) {
  const m = useT();
  return (
    <ul className={styles.files}>
      {files.map((file) => {
        const [dir, name] = splitPath(file.path);
        return (
          <li key={file.path} className={styles.row}>
            <button
              type="button"
              className={`${styles.file} ${file.path === selectedPath ? styles.active : ""}`}
              onClick={() => onSelect(file)}
              title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
            >
              <span className={`${styles.status} ${styles[file.status]}`}>{STATUS_LETTER[file.status]}</span>
              <span className={styles.name}>
                <span className={styles.base}>{name}</span>
                {dir && <span className={styles.dir}>&nbsp;{dir}</span>}
              </span>
              <span className={styles.numbers}>
                {file.binary ? (
                  <i className={styles.muted}>{m.diff.binaryShort}</i>
                ) : file.additions === null ? null : (
                  <>
                    <i className={styles.add}>+{file.additions}</i>
                    <i className={styles.del}>−{file.deletions}</i>
                  </>
                )}
              </span>
            </button>
            {onHistory && (
              <button
                type="button"
                className={styles.history}
                aria-label={m.details.fileHistory(name)}
                title={m.details.fileHistory(name)}
                onClick={() => onHistory(file.path)}
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                  <path d="M3 3v5h5M12 7v5l3 2" />
                </svg>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
