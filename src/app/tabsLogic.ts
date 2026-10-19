import type { RepoInfo } from "../lib/bindings";

export interface Tab {
  /** The backend session id, which is also the tab id. */
  id: string;
  repo: RepoInfo;
  /** Index into the branch palette, shown as the tab's dot. */
  color: number;
}

export interface RecentRepo {
  path: string;
  name: string;
}

export interface TabsData {
  tabs: Tab[];
  activeId: string | null;
  recents: RecentRepo[];
  /** Colour given to the next tab. */
  nextColor: number;
  /**
   * Two tabs shown at once, the top one first; the active tab is one of them and has the
   * keyboard. Null when the active tab fills the window.
   */
  split: [string, string] | null;
}

export const MAX_RECENTS = 8;
const PALETTE = 8;

export const emptyTabs: TabsData = { tabs: [], activeId: null, recents: [], nextColor: 0, split: null };

/** Trailing slashes do not make a different repository. */
export function normalizePath(path: string): string {
  const trimmed = path.trim();
  // A root keeps its separator: "/" on Unix, "C:\" on Windows.
  if (/^([A-Za-z]:)?[\\/]$/.test(trimmed)) return trimmed;
  return trimmed.replace(/[\\/]+$/, "");
}

export function findTabByPath(data: TabsData, path: string): Tab | undefined {
  const wanted = normalizePath(path);
  return data.tabs.find((tab) => normalizePath(tab.repo.path) === wanted);
}

/**
 * Shows tab `id` with the keyboard. In a split view a tab that is not shown yet takes the place
 * of the active one.
 */
function show(data: TabsData, id: string): TabsData {
  const split = data.split;
  if (!split || split.includes(id)) return { ...data, activeId: id };
  return { ...data, activeId: id, split: split[0] === data.activeId ? [id, split[1]] : [split[0], id] };
}

function withTab(data: TabsData, repo: RepoInfo): TabsData {
  const tab: Tab = { id: repo.sessionId, repo, color: data.nextColor % PALETTE };
  const recent: RecentRepo = { path: normalizePath(repo.path), name: repo.name };
  return {
    ...data,
    tabs: [...data.tabs, tab],
    nextColor: data.nextColor + 1,
    recents: [recent, ...data.recents.filter((r) => r.path !== recent.path)].slice(0, MAX_RECENTS),
  };
}

/** Opens a tab for `repo` and makes it the active one; the repo moves to the front of the recents. */
export function addTab(data: TabsData, repo: RepoInfo): TabsData {
  return show(withTab(data, repo), repo.sessionId);
}

/** Opens a tab for `repo` and shows it below the active one (see `openSplit`). */
export function addTabAlongside(data: TabsData, repo: RepoInfo): TabsData {
  const added = withTab(data, repo);
  return data.activeId ? openSplit(added, repo.sessionId) : show(added, repo.sessionId);
}

/**
 * Shows tab `id` below the active one, and gives it the keyboard. In a split view already, it
 * takes the place of the other tab.
 */
export function openSplit(data: TabsData, id: string): TabsData {
  const active = data.activeId;
  if (active === null || active === id || !data.tabs.some((tab) => tab.id === id)) return data;
  if (data.split?.includes(id)) return { ...data, activeId: id };
  const split: [string, string] = data.split?.[1] === active ? [id, active] : [active, id];
  return { ...data, activeId: id, split };
}

/** Back to one tab, the active one. */
export function closeSplit(data: TabsData): TabsData {
  return data.split ? { ...data, split: null } : data;
}

/** Swaps the two tabs of a split view. */
export function swapSplit(data: TabsData): TabsData {
  return data.split ? { ...data, split: [data.split[1], data.split[0]] } : data;
}

/**
 * Closes a tab. When it was the active one, the tab on its left (or else on its right) takes
 * over; in a split view, the other tab of the split does, alone.
 */
export function closeTab(data: TabsData, id: string): TabsData {
  const at = data.tabs.findIndex((tab) => tab.id === id);
  if (at < 0) return data;
  const tabs = data.tabs.filter((tab) => tab.id !== id);
  if (data.split?.includes(id)) {
    const other = data.split[0] === id ? data.split[1] : data.split[0];
    return { ...data, tabs, activeId: other, split: null };
  }
  const activeId =
    data.activeId !== id ? data.activeId : (tabs[Math.max(0, at - 1)]?.id ?? null);
  return { ...data, tabs, activeId };
}

export function activate(data: TabsData, id: string): TabsData {
  return data.tabs.some((tab) => tab.id === id) ? show(data, id) : data;
}

/** ⌘1…⌘9: the tab at position `position` (0-based); ⌘9 conventionally means the last one. */
export function activateAt(data: TabsData, position: number, last = false): TabsData {
  const tab = last ? data.tabs[data.tabs.length - 1] : data.tabs[position];
  return tab ? show(data, tab.id) : data;
}

export function removeRecent(data: TabsData, path: string): TabsData {
  return { ...data, recents: data.recents.filter((r) => r.path !== path) };
}

/** Moves a tab to position `to` (clamped), keeping the others in order. */
export function moveTab(data: TabsData, id: string, to: number): TabsData {
  const from = data.tabs.findIndex((tab) => tab.id === id);
  if (from < 0) return data;
  const target = Math.max(0, Math.min(data.tabs.length - 1, to));
  if (target === from) return data;
  const tabs = data.tabs.slice();
  const [tab] = tabs.splice(from, 1);
  if (tab) tabs.splice(target, 0, tab);
  return { ...data, tabs };
}

/** The open tabs as they are saved for the next launch. */
export interface SavedSession {
  paths: string[];
  active: string | null;
  /** The two repositories of a split view, top first; missing in sessions saved before it. */
  split?: [string, string] | null;
}

export const emptySession: SavedSession = { paths: [], active: null };

export function sessionOf(data: TabsData): SavedSession {
  const pathOf = (id: string | null) => {
    const tab = data.tabs.find((t) => t.id === id);
    return tab ? normalizePath(tab.repo.path) : null;
  };
  const top = pathOf(data.split?.[0] ?? null);
  const bottom = pathOf(data.split?.[1] ?? null);
  return {
    paths: data.tabs.map((tab) => normalizePath(tab.repo.path)),
    active: pathOf(data.activeId),
    split: top !== null && bottom !== null ? [top, bottom] : null,
  };
}

/**
 * Adds the tabs reopened from a saved session, in their saved order, after any tab opened in the
 * meantime. Repositories that already have a tab are skipped (their ids are returned so the
 * caller can release those sessions). The saved active tab takes focus unless the user already
 * opened one; the saved split view comes back with it when both its repositories reopened.
 */
export function restoreTabs(data: TabsData, repos: RepoInfo[], activePath: string | null, splitPaths: [string, string] | null = null): { data: TabsData; duplicates: string[] } {
  const duplicates: string[] = [];
  let next = data;
  for (const repo of repos) {
    if (findTabByPath(next, repo.path)) duplicates.push(repo.sessionId);
    else next = { ...withTab(next, repo), recents: next.recents };
  }
  if (data.activeId) next = { ...next, activeId: data.activeId };
  else {
    const wanted = activePath ? findTabByPath(next, activePath) : undefined;
    next = { ...next, activeId: wanted?.id ?? next.tabs[0]?.id ?? null };
    const top = splitPaths ? findTabByPath(next, splitPaths[0]) : undefined;
    const bottom = splitPaths ? findTabByPath(next, splitPaths[1]) : undefined;
    if (top && bottom && top !== bottom) {
      const activeId = next.activeId === bottom.id ? bottom.id : top.id;
      next = { ...next, activeId, split: [top.id, bottom.id] };
    }
  }
  return { data: next, duplicates };
}

/**
 * Where a dragged tab goes: past every other tab whose centre is left of the dragged tab's
 * centre. Comparing centres (not the pointer against tab bounds) keeps tabs of different widths
 * from swapping back and forth.
 */
export function dropIndex(otherCenters: number[], draggedCenter: number): number {
  return otherCenters.filter((center) => center < draggedCenter).length;
}

/**
 * Where a dragged tab is drawn, as an offset from its place in the row: it follows the pointer
 * (`left` = where it started plus how far the pointer went) but stays within the row of tabs.
 */
export function dragOffset(left: number, place: number, width: number, rowStart: number, rowEnd: number): number {
  const clamped = Math.max(rowStart, Math.min(rowEnd - width, left));
  return clamped - place;
}
