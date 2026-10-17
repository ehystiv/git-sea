import type { RefKind, RefLabel, StashEntry } from "../../lib/bindings";
import { t, type Messages } from "../../lib/i18n";

export interface SidebarItem {
  key: string;
  label: string;
  /** Commit to jump to when the item is clicked. */
  commit: string | null;
  isHead?: boolean;
  title?: string;
  /** The ref behind the item, for the branch filter (not for stashes). */
  ref?: { kind: RefKind; name: string };
}

export interface SidebarSection {
  id: "branches" | "remotes" | "tags" | "stashes";
  title: string;
  items: SidebarItem[];
}

const byName = (a: SidebarItem, b: SidebarItem) =>
  a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });

/** Every ref group of the sidebar, filtered by `filter` (case-insensitive); empty groups are dropped. */
export function buildSections(
  refs: Iterable<RefLabel[]>,
  stashes: StashEntry[],
  filter: string,
  m: Messages = t(),
): SidebarSection[] {
  const branches: SidebarItem[] = [];
  const remotes: SidebarItem[] = [];
  const tags: SidebarItem[] = [];

  for (const labels of refs) {
    for (const ref of labels) {
      const item: SidebarItem = { key: `${ref.kind}:${ref.name}`, label: ref.name, commit: ref.commit, ref: { kind: ref.kind, name: ref.name } };
      if (ref.kind === "Tag") tags.push(item);
      else if (ref.kind === "Remote") remotes.push(item);
      else branches.push({ ...item, isHead: ref.kind === "Head" });
    }
  }

  branches.sort((a, b) => Number(b.isHead ?? false) - Number(a.isHead ?? false) || byName(a, b));
  remotes.sort(byName);
  // Newest versions first: v10 before v9.
  tags.sort((a, b) => byName(b, a));

  const stashItems: SidebarItem[] = stashes.map((s) => ({
    key: `stash:${s.index}`,
    label: s.message,
    commit: s.base,
    title: m.sidebar.stashTitle(s.index),
  }));

  const needle = filter.trim().toLowerCase();
  const keep = (item: SidebarItem) => needle === "" || item.label.toLowerCase().includes(needle);

  return (
    [
      { id: "branches", title: m.sidebar.sections.branches, items: branches },
      { id: "remotes", title: m.sidebar.sections.remotes, items: remotes },
      { id: "tags", title: m.sidebar.sections.tags, items: tags },
      { id: "stashes", title: m.sidebar.sections.stashes, items: stashItems },
    ] as SidebarSection[]
  )
    .map((section) => ({ ...section, items: section.items.filter(keep) }))
    .filter((section) => section.items.length > 0);
}
