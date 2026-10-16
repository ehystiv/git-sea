import { useMemo, useState } from "react";
import type { CiProvider, RefFilter } from "../../lib/bindings";
import { CiSection } from "../ci/CiSection";
import type { CiState } from "../ci/useCi";
import type { GraphIndex } from "../graph/GraphIndex";
import { inFilter } from "./refFilter";
import { buildSections, type SidebarItem } from "./sections";
import { useStashes } from "./useStashes";
import styles from "./Sidebar.module.css";

interface SidebarProps {
  sessionId: string;
  index: GraphIndex;
  /** Changes whenever the index gets new data (refs arrive before the commits). */
  version: number;
  selectedId: string | null;
  onSelectCommit: (id: string) => void;
  /** Refs the graph is limited to, or null for the whole history. */
  branchFilter: RefFilter[] | null;
  onToggleFilter: (ref: NonNullable<SidebarItem["ref"]>) => void;
  ci: CiState;
  /** The workflow whose markers alone are shown on the graph, or null for all. */
  ciFocus: number | null;
  onCiFocus: (id: number | null) => void;
  /** The CI service whose token field is open. */
  tokenFor: CiProvider | null;
  onTokenFor: (provider: CiProvider | null) => void;
}

const icon = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const TAG = "M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z";
const FUNNEL = "M22 3H2l8 9.46V19l4 2v-8.54z";
const STASH = "M2 3h20v5H2z M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8 M10 12h4";

export function Sidebar({
  sessionId,
  index,
  version,
  selectedId,
  onSelectCommit,
  branchFilter,
  onToggleFilter,
  ci,
  ciFocus,
  onCiFocus,
  tokenFor,
  onTokenFor,
}: SidebarProps) {
  const stashes = useStashes(sessionId);
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  // `version` is what tells us the (mutable) index changed.
  const sections = useMemo(() => buildSections(index.refs.values(), stashes.data ?? [], filter), [index, version, stashes.data, filter]);

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  return (
    <nav className={styles.sidebar} aria-label="Riferimenti">
      <div className={styles.search}>
        <svg viewBox="0 0 24 24" width="13" height="13" {...icon}>
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtra…" spellCheck={false} aria-label="Filtra i riferimenti" />
      </div>

      {sections.length === 0 && !ci.overview?.workflows.length && <p className={styles.none}>{filter ? "Nessun risultato." : "Nessun riferimento."}</p>}

      {sections.map((section) => {
        const open = !collapsed.has(section.id);
        return (
          <section key={section.id} className={styles.group}>
            <h3>
              <button type="button" className={styles.heading} aria-expanded={open} onClick={() => toggle(section.id)}>
                <svg viewBox="0 0 24 24" width="11" height="11" {...icon} className={open ? undefined : styles.closed}>
                  <path d="m6 9 6 6 6-6" />
                </svg>
                {section.title}
                <span className={styles.count}>{section.items.length}</span>
              </button>
            </h3>
            {open && (
              <ul>
                {section.items.map((item) => {
                  const at = item.commit === null ? null : index.indexOf(item.commit);
                  const color = at === null ? null : index.rows[at]?.color;
                  const ref = item.ref;
                  const filtered = ref !== undefined && inFilter(branchFilter, ref);
                  const missing = branchFilter !== null ? "Fuori dal filtro dei branch" : "Commit non ancora caricato";
                  return (
                    <li key={item.key} className={styles.row}>
                      <button
                        type="button"
                        className={`${styles.item} ${item.commit !== null && item.commit === selectedId ? styles.active : ""} ${item.isHead ? styles.head : ""}`}
                        disabled={at === null}
                        title={item.title ?? (at === null ? missing : item.label)}
                        onClick={() => item.commit !== null && onSelectCommit(item.commit)}
                      >
                        {section.id === "tags" || section.id === "stashes" ? (
                          <svg viewBox="0 0 24 24" width="12" height="12" {...icon} className={styles.glyph}>
                            <path d={section.id === "tags" ? TAG : STASH} />
                          </svg>
                        ) : (
                          <span className={styles.dot} style={{ background: color == null ? "var(--text-3)" : `var(--b${color % 8})` }} />
                        )}
                        <span className={styles.label}>{item.label}</span>
                      </button>
                      {ref && (
                        <button
                          type="button"
                          className={`${styles.filter} ${filtered ? styles.on : ""}`}
                          aria-pressed={filtered}
                          aria-label={filtered ? `Togli ${ref.name} dal filtro` : `Mostra solo ${ref.name}`}
                          title={filtered ? "Togli dal filtro" : branchFilter ? "Aggiungi al filtro" : "Mostra solo questo"}
                          onClick={() => onToggleFilter(ref)}
                        >
                          <svg viewBox="0 0 24 24" width="11" height="11" {...icon} fill={filtered ? "currentColor" : "none"}>
                            <path d={FUNNEL} />
                          </svg>
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      <CiSection
        ci={ci}
        filter={filter}
        // Asking for a token opens the group, wherever it comes from (the palette, too).
        open={!collapsed.has("workflows") || tokenFor !== null}
        onToggle={() => toggle("workflows")}
        focus={ciFocus}
        onFocus={onCiFocus}
        tokenFor={tokenFor}
        onTokenFor={onTokenFor}
      />
    </nav>
  );
}
