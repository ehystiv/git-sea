import type { RefFilter, RefKind } from "../../lib/bindings";
import { t, type Messages } from "../../lib/i18n";

/** Anything naming a ref: a filter entry or a label from the backend. */
interface NamedRef {
  kind: RefKind;
  name: string;
}

const isLocal = (kind: RefKind) => kind === "Head" || kind === "Branch";

/** Same ref, counting a local branch the same whether HEAD is on it or not (as the backend does). */
export function sameRef(a: NamedRef, b: NamedRef): boolean {
  if (a.name !== b.name) return false;
  if (a.kind === b.kind) return true;
  return isLocal(a.kind) && isLocal(b.kind) && a.name !== "HEAD";
}

export function inFilter(filter: readonly RefFilter[] | null, ref: NamedRef): boolean {
  return filter !== null && filter.some((f) => sameRef(f, ref));
}

/** Adds the ref to the filter, or takes it out; an emptied filter is no filter (null). */
export function toggleRef(filter: readonly RefFilter[] | null, ref: NamedRef): RefFilter[] | null {
  const entry: RefFilter = { kind: ref.kind, name: ref.name };
  if (!inFilter(filter, ref)) return [...(filter ?? []), entry];
  const rest = (filter ?? []).filter((f) => !sameRef(f, ref));
  return rest.length > 0 ? rest : null;
}

/**
 * Drops the refs that no longer exist (deleted branch), so the graph does not go empty. Returns
 * the same array when nothing changed, which lets a caller skip a reload.
 */
export function pruneFilter(filter: RefFilter[] | null, existing: Iterable<NamedRef>): RefFilter[] | null {
  if (filter === null) return null;
  const all = [...existing];
  const kept = filter.filter((f) => all.some((ref) => sameRef(f, ref)));
  if (kept.length === filter.length) return filter;
  return kept.length > 0 ? kept : null;
}

/** "main", "main, dev" or "main e altri 2", for the toolbar. */
export function describeFilter(filter: readonly RefFilter[], m: Messages = t()): string {
  const [first, second] = filter;
  if (!first) return "";
  if (filter.length === 1) return first.name;
  if (filter.length === 2 && second) return `${first.name}, ${second.name}`;
  return m.filter.andMore(first.name, filter.length - 1);
}
