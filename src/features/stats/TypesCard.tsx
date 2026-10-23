import { useMemo } from "react";
import { formatCount } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { authorsOf } from "../commits/authors";
import { typeStats } from "../commits/conventional";
import type { GraphIndex } from "../graph/GraphIndex";
import styles from "./StatsView.module.css";

/** Scopes listed; the rest can be found with `scope:`. */
const TOP_SCOPES = 24;

/** The CSS class of a type's colour, as in the graph and the list. */
const TYPE_CLASS: Record<string, string> = { feat: "feat", fix: "fix", perf: "fix", refactor: "refactor", docs: "docs" };

interface TypesCardProps {
  index: GraphIndex;
  version: number;
  /** Only this author's commits count, when set. */
  author: string | null;
  onSearch: (text: string) => void;
}

/** How many commits of each Conventional Commits type and scope; a click lists them. */
export function TypesCard({ index, version, author, onSearch }: TypesCardProps) {
  const m = useT();
  // `version` stands for the contents of `index`, which is mutated in place.
  const stats = useMemo(() => typeStats(index.commits, author === null ? undefined : (c) => authorsOf(c).includes(author)), [index, version, author]);
  if (stats.conventional === 0) return null;
  const top = stats.types[0]?.commits ?? 1;

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>{m.stats.types}</h2>
        <span className={styles.note}>
          {m.stats.typesNote(formatCount(stats.conventional), formatCount(stats.commits))}
          {stats.breaking > 0 && ` ${m.stats.breaking(formatCount(stats.breaking))}`}
        </span>
      </div>
      <ol className={styles.authors}>
        {stats.types.map((entry) => (
          <li key={entry.type} className={styles.author}>
            <button type="button" className={`${styles.authorMain} ${styles.typeMain}`} title={m.stats.typeTitle(entry.type)} onClick={() => onSearch(`type:${entry.type}`)}>
              <span className={`${styles.typeName} ${styles[TYPE_CLASS[entry.type] ?? ""] ?? ""}`}>{entry.type}</span>
              <span className={styles.bar}>
                <span style={{ width: `${(entry.commits / top) * 100}%` }} />
              </span>
              <span className={styles.count}>{formatCount(entry.commits)}</span>
              <span className={styles.share}>{m.stats.share(String(Math.round((entry.commits / stats.conventional) * 100)))}</span>
            </button>
          </li>
        ))}
      </ol>
      {stats.scopes.length > 0 && (
        <>
          <h3 className={styles.subhead}>{m.stats.scopes}</h3>
          <div className={styles.scopes}>
            {stats.scopes.slice(0, TOP_SCOPES).map((entry) => (
              <button key={entry.scope} type="button" className={styles.scope} onClick={() => onSearch(`scope:${entry.scope}`)}>
                {entry.scope}
                <span>{formatCount(entry.commits)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
