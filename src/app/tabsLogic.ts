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
