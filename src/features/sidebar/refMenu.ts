import type { MenuItem } from "../../components/ContextMenu/ContextMenu";
import type { RefLabel } from "../../lib/bindings";
import { t, type Messages } from "../../lib/i18n";

export interface RefMenuActions {
  /** Compares `target` with `base`: from their common ancestor when `fromBase`, else tree to tree. */
  compare: (base: string, target: string, fromBase: boolean) => void;
  showOnly: () => void;
}

/**
 * The items of the right-click menu of a branch, remote branch or tag: what it brings over HEAD
 * (and over the selected commit), compared from the common base, or its whole tree against them.
 */
export function refMenuItems(ref: RefLabel, head: RefLabel | null, selectedId: string | null, actions: RefMenuActions, m: Messages = t()): MenuItem[] {
  const items: MenuItem[] = [];
  if (head && head.commit !== ref.commit) {
    items.push({ id: "brings-head", label: m.refMenu.whatBrings(head.name), hint: m.refMenu.whatBringsHint, run: () => actions.compare(head.commit, ref.commit, true) });
    items.push({ id: "compare-head", label: m.refMenu.compareWith(head.name), run: () => actions.compare(head.commit, ref.commit, false) });
  }
  if (selectedId !== null && selectedId !== ref.commit && selectedId !== head?.commit) {
    items.push({ id: "brings-selected", label: m.refMenu.whatBrings(m.refMenu.selected), hint: m.refMenu.whatBringsHint, run: () => actions.compare(selectedId, ref.commit, true), separated: items.length > 0 });
  }
  items.push({ id: "show-only", label: m.refMenu.showOnly, run: actions.showOnly, separated: items.length > 0 });
  return items;
}
