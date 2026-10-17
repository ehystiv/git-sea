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
}

export const MAX_RECENTS = 8;
const PALETTE = 8;

export const emptyTabs: TabsData = { tabs: [], activeId: null, recents: [], nextColor: 0 };

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

/** Opens a tab for `repo` and makes it the active one; the repo moves to the front of the recents. */
export function addTab(data: TabsData, repo: RepoInfo): TabsData {
  const tab: Tab = { id: repo.sessionId, repo, color: data.nextColor % PALETTE };
  const recent: RecentRepo = { path: normalizePath(repo.path), name: repo.name };
  return {
    tabs: [...data.tabs, tab],
    activeId: tab.id,
    nextColor: data.nextColor + 1,
    recents: [recent, ...data.recents.filter((r) => r.path !== recent.path)].slice(0, MAX_RECENTS),
  };
}

/** Closes a tab. When it was the active one, the tab on its left (or else on its right) takes over. */
export function closeTab(data: TabsData, id: string): TabsData {
  const at = data.tabs.findIndex((tab) => tab.id === id);
  if (at < 0) return data;
  const tabs = data.tabs.filter((tab) => tab.id !== id);
  const activeId =
    data.activeId !== id ? data.activeId : (tabs[Math.max(0, at - 1)]?.id ?? null);
  return { ...data, tabs, activeId };
}

export function activate(data: TabsData, id: string): TabsData {
  return data.tabs.some((tab) => tab.id === id) ? { ...data, activeId: id } : data;
}

/** ⌘1…⌘9: the tab at position `position` (0-based); ⌘9 conventionally means the last one. */
export function activateAt(data: TabsData, position: number, last = false): TabsData {
  const tab = last ? data.tabs[data.tabs.length - 1] : data.tabs[position];
  return tab ? { ...data, activeId: tab.id } : data;
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
}

export const emptySession: SavedSession = { paths: [], active: null };

export function sessionOf(data: TabsData): SavedSession {
  const active = data.tabs.find((tab) => tab.id === data.activeId);
  return {
    paths: data.tabs.map((tab) => normalizePath(tab.repo.path)),
    active: active ? normalizePath(active.repo.path) : null,
  };
}

/**
 * Adds the tabs reopened from a saved session, in their saved order, after any tab opened in the
 * meantime. Repositories that already have a tab are skipped (their ids are returned so the
 * caller can release those sessions). The saved active tab takes focus unless the user already
 * opened one.
 */
export function restoreTabs(data: TabsData, repos: RepoInfo[], activePath: string | null): { data: TabsData; duplicates: string[] } {
  const duplicates: string[] = [];
  let next = data;
  for (const repo of repos) {
    if (findTabByPath(next, repo.path)) duplicates.push(repo.sessionId);
    else next = { ...addTab(next, repo), recents: next.recents };
  }
  if (data.activeId) next = { ...next, activeId: data.activeId };
  else {
    const wanted = activePath ? findTabByPath(next, activePath) : undefined;
    next = { ...next, activeId: wanted?.id ?? next.tabs[0]?.id ?? null };
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
