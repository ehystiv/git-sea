import type { MenuItem } from "../../components/ContextMenu/ContextMenu";
import type { CommitSummary, RepoWeb } from "../../lib/bindings";
import { shortHash } from "../../lib/format";
import { t, type Messages } from "../../lib/i18n";

export interface CommitMenuActions {
  copy: (text: string) => void;
  /** Copies the whole message, which the summary does not hold. */
  copyMessage: (commit: CommitSummary) => void;
  compare: (commit: CommitSummary) => void;
  toggleBookmark: (commit: CommitSummary) => void;
  openUrl: (url: string) => void;
  /** Opens the replay starting or ending at the commit; without them there are no such items. */
  replayFrom?: (commit: CommitSummary) => void;
  replayTo?: (commit: CommitSummary) => void;
}

/** The items of the right-click menu of a commit. */
export function commitMenuItems(
  commit: CommitSummary,
  selectedId: string | null,
  web: RepoWeb | null,
  bookmarked: boolean,
  actions: CommitMenuActions,
  m: Messages = t(),
): MenuItem[] {
  const items: MenuItem[] = [
    { id: "copy-hash", label: m.menu.copyHash, hint: shortHash(commit.id), run: () => actions.copy(commit.id) },
    { id: "copy-short", label: m.menu.copyShortHash, run: () => actions.copy(shortHash(commit.id)) },
    { id: "copy-message", label: m.menu.copyMessage, run: () => actions.copyMessage(commit) },
  ];
  if (selectedId !== null && selectedId !== commit.id) {
    items.push({ id: "compare", label: m.menu.compareWithSelected, hint: m.menu.shiftClick, run: () => actions.compare(commit), separated: true });
  }
  items.push({
    id: "bookmark",
    label: bookmarked ? m.menu.removeBookmark : m.menu.addBookmark,
    hint: commit.id === selectedId ? "b" : undefined,
    run: () => actions.toggleBookmark(commit),
    separated: !items.some((i) => i.id === "compare"),
  });
  const { replayFrom, replayTo } = actions;
  if (replayFrom && replayTo) {
    items.push({ id: "replay-from", label: m.menu.replayFrom, run: () => replayFrom(commit), separated: true });
    items.push({ id: "replay-to", label: m.menu.replayTo, run: () => replayTo(commit) });
  }
  if (web) {
    items.push({ id: "open-web", label: m.menu.openOn(web.name), run: () => actions.openUrl(`${web.commitUrl}${commit.id}`), separated: true });
  }
  return items;
}
