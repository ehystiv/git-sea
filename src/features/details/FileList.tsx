import type { ChangeStatus, FileChange } from "../../lib/bindings";
import { splitPath } from "../../lib/format";
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
}

export function FileList({ files, selectedPath, onSelect }: FileListProps) {
  return (
    <ul className={styles.files}>
      {files.map((file) => {
        const [dir, name] = splitPath(file.path);
        return (
          <li key={file.path}>
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
                  <i className={styles.muted}>binario</i>
                ) : file.additions === null ? null : (
                  <>
                    <i className={styles.add}>+{file.additions}</i>
                    <i className={styles.del}>−{file.deletions}</i>
                  </>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
