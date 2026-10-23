import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { commands, type CleanupReport } from "../../lib/bindings";
import { copyText } from "../../lib/clipboard";
import { CommandError, describeError } from "../../lib/errors";
import { useT } from "../../lib/i18n";
import type { GraphIndex } from "../graph/GraphIndex";
import { cleanupCommand, cleanupGroups, type CleanupGroup } from "./cleanup";
import styles from "./Sidebar.module.css";

const icon = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** What can be cleaned up; asks the remotes, so only while the section is open. */
export function useCleanup(sessionId: string, enabled: boolean) {
  return useQuery<CleanupReport, CommandError>({
    queryKey: ["cleanup", sessionId],
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const result = await commands.cleanupReport(sessionId);
      if (result.status === "error") throw new CommandError(result.error);
      return result.data;
    },
  });
}

interface CleanupSectionProps {
  sessionId: string;
  index: GraphIndex;
  selectedId: string | null;
  onSelectCommit: (id: string) => void;
}

/** "Cleanup" group of the sidebar: branches gone from the remote, merged, or without upstream. */
export function CleanupSection({ sessionId, index, selectedId, onSelectCommit }: CleanupSectionProps) {
  const m = useT();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<CleanupGroup | null>(null);
  const report = useCleanup(sessionId, open);
  const groups = report.data ? cleanupGroups(report.data) : [];
  const total = groups.reduce((sum, g) => sum + g.refs.length, 0);

  async function copy(group: CleanupGroup, command: string) {
    await copyText(command);
    setCopied(group);
    setTimeout(() => setCopied((c) => (c === group ? null : c)), 1200);
  }

  return (
    <section className={styles.group}>
      <h3>
        <button type="button" className={styles.heading} aria-expanded={open} title={m.cleanup.hint} onClick={() => setOpen((o) => !o)}>
          <svg viewBox="0 0 24 24" width="11" height="11" {...icon} className={open ? undefined : styles.closed}>
            <path d="m6 9 6 6 6-6" />
          </svg>
          {m.cleanup.title}
          {report.data && <span className={styles.count}>{total}</span>}
        </button>
      </h3>
      {open && (
        <div>
          {report.isFetching && <p className={styles.none}>{m.cleanup.checking}</p>}
          {report.isError && <p className={styles.none}>{describeError(report.error, m)}</p>}
          {report.data?.errors.map((error) => (
            <p key={error} className={styles.none}>
              {error}
            </p>
          ))}
          {report.data && total === 0 && !report.isFetching && <p className={styles.none}>{m.cleanup.nothing}</p>}
          {groups.map(({ group, refs }) => {
            const command = cleanupCommand(group, refs);
            return (
              <div key={group} className={styles.cleanupGroup}>
                <div className={styles.cleanupHead} title={m.cleanup.groupTitles[group]}>
                  <span>{m.cleanup.groups[group]}</span>
                  {command && (
                    <button type="button" className={styles.cleanupCopy} title={`${m.cleanup.copy}\n${command}`} onClick={() => void copy(group, command)}>
                      {copied === group ? m.cleanup.copied : m.cleanup.copy}
                    </button>
                  )}
                </div>
                <ul>
                  {refs.map((ref) => {
                    const loaded = index.indexOf(ref.commit) !== null;
                    return (
                      <li key={ref.name} className={styles.row}>
                        <button
                          type="button"
                          className={`${styles.item} ${ref.commit === selectedId ? styles.active : ""}`}
                          disabled={!loaded}
                          title={loaded ? ref.name : m.cleanup.notLoaded}
                          onClick={() => onSelectCommit(ref.commit)}
                        >
                          <span className={styles.dot} style={{ background: "var(--text-3)" }} />
                          <span className={styles.label}>{ref.name}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {report.data && (
            <button type="button" className={styles.cleanupCopy} disabled={report.isFetching} onClick={() => void report.refetch()}>
              {m.cleanup.recheck}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
