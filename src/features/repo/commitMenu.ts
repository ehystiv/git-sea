import type { MenuItem } from "../../components/ContextMenu/ContextMenu";
import type { CommitSummary, RepoWeb } from "../../lib/bindings";
import { shortHash } from "../../lib/format";
import { t, type Messages } from "../../lib/i18n";

export interface CommitMenuActions {
  copy: (text: string) => void;
  /** Copies the whole message, which the summary does not hold. */
  copyMessage: (commit: CommitSummary) => void;
  compare: (commit: CommitSummary) => void;
  openUrl: (url: string) => void;
}

/** The items of the right-click menu of a commit. */
export function commitMenuItems(
  commit: CommitSummary,
  selectedId: string | null,
  web: RepoWeb | null,
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
  if (web) {
    items.push({ id: "open-web", label: m.menu.openOn(web.name), run: () => actions.openUrl(`${web.commitUrl}${commit.id}`), separated: true });
  }
  return items;
}
