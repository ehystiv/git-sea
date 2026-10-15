import type { RefLabel, StashEntry } from "../../lib/bindings";

export interface SidebarItem {
  key: string;
  label: string;
  /** Commit to jump to when the item is clicked. */
  commit: string | null;
  isHead?: boolean;
  title?: string;
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
): SidebarSection[] {
  const branches: SidebarItem[] = [];
  const remotes: SidebarItem[] = [];
  const tags: SidebarItem[] = [];

  for (const labels of refs) {
    for (const ref of labels) {
      const item: SidebarItem = { key: `${ref.kind}:${ref.name}`, label: ref.name, commit: ref.commit };
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
    title: `stash@{${s.index}}: salta al commit su cui è stato creato`,
  }));

  const needle = filter.trim().toLowerCase();
  const keep = (item: SidebarItem) => needle === "" || item.label.toLowerCase().includes(needle);

  return (
    [
      { id: "branches", title: "Branch locali", items: branches },
      { id: "remotes", title: "Remote", items: remotes },
      { id: "tags", title: "Tag", items: tags },
      { id: "stashes", title: "Stash", items: stashItems },
    ] as SidebarSection[]
  )
    .map((section) => ({ ...section, items: section.items.filter(keep) }))
    .filter((section) => section.items.length > 0);
}
