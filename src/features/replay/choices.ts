import type { RefLabel } from "../../lib/bindings";
import { shortHash } from "../../lib/format";
import { t, type Messages } from "../../lib/i18n";
import { containingRefs } from "../graph/contains";
import type { GraphIndex } from "../graph/GraphIndex";

/** A commit the replay can start or end at, as the menus offer it. */
export interface ReplayChoice {
  key: string;
  label: string;
  /** Null: the whole history (as an end), or its first commit (as a start). */
  commit: string | null;
}

/** Commits picked from the right-click menu: "replay from here", "replay up to here". */
export interface ReplayPicks {
  start?: string;
  end?: string;
}

export interface ReplayChoices {
  ends: ReplayChoice[];
  starts: ReplayChoice[];
  initialEnd: string;
  initialStart: string;
}

const SUMMARY_CHARS = 48;

function commitLabel(index: GraphIndex, id: string, m: Messages, selected: boolean): string {
  const summary = index.commits[index.indexOf(id) ?? -1]?.summary ?? "";
  const cut = summary.length > SUMMARY_CHARS ? `${summary.slice(0, SUMMARY_CHARS - 1)}…` : summary;
  return selected ? m.replay.selected(shortHash(id), cut) : m.replay.commit(shortHash(id), cut);
}

const branchKey = (ref: RefLabel) => (ref.kind === "Remote" ? `r:${ref.name}` : ref.kind === "Tag" ? `t:${ref.name}` : `b:${ref.name}`);

/**
 * What the replay can start and end at: the whole history, the selected commit, the commits picked
 * from the menu, and every branch and tag. It ends at first at the branch of the selected commit:
 * the branch it is the tip of, else the local branch holding it (HEAD's first); it starts at the
 * first commit. Picks from the menu win over both.
 */
export function replayChoices(index: GraphIndex, selectedId: string | null, picks: ReplayPicks, m: Messages = t()): ReplayChoices {
  const refs = [...index.refs.values()].flat().filter((ref) => index.indexOf(ref.commit) !== null);
  const time = (ref: RefLabel) => index.commits[index.indexOf(ref.commit) ?? -1]?.time ?? 0;
  const byName = (a: RefLabel, b: RefLabel) => a.name.localeCompare(b.name, undefined, { numeric: true });
  const local = refs.filter((r) => r.kind === "Head" || r.kind === "Branch").sort((a, b) => Number(b.kind === "Head") - Number(a.kind === "Head") || byName(a, b));
  const tags = refs.filter((r) => r.kind === "Tag").sort((a, b) => time(b) - time(a) || byName(b, a));
  const remotes = refs.filter((r) => r.kind === "Remote").sort(byName);
  const asChoice = (ref: RefLabel): ReplayChoice => ({ key: branchKey(ref), label: ref.kind === "Tag" ? m.replay.tag(ref.name) : ref.name, commit: ref.commit });

  const special = (key: string, id: string | undefined | null, selected: boolean): ReplayChoice[] =>
    id && index.indexOf(id) !== null ? [{ key, label: commitLabel(index, id, m, selected), commit: id }] : [];
  const picked = (id: string | undefined, key: string) => (id && id !== selectedId ? special(key, id, false) : []);

  const ends: ReplayChoice[] = [
    { key: "all", label: m.replay.wholeHistory, commit: null },
    ...special("selected", selectedId, true),
    ...picked(picks.end, "picked-end"),
    ...local.map(asChoice),
    ...tags.map(asChoice),
    ...remotes.map(asChoice),
  ];
  const starts: ReplayChoice[] = [
    { key: "first", label: m.replay.firstCommit, commit: null },
    ...special("selected", selectedId, true),
    ...picked(picks.start, "picked-start"),
    ...tags.map(asChoice),
    ...local.map(asChoice),
    ...remotes.map(asChoice),
  ];

  const keyOf = (id: string, fallback: string) => (id === selectedId ? "selected" : fallback);
  let initialEnd = "all";
  if (picks.end) initialEnd = keyOf(picks.end, "picked-end");
  else if (selectedId !== null) {
    const at = index.indexOf(selectedId);
    const own = (index.refs.get(selectedId) ?? []).filter((r) => r.kind === "Head" || r.kind === "Branch" || r.kind === "Remote");
    const tip = own.sort((a, b) => (a.kind === "Remote" ? 1 : 0) - (b.kind === "Remote" ? 1 : 0))[0];
    const holder = tip ?? (at === null ? undefined : containingRefs(index, at).branches[0]);
    if (holder) initialEnd = branchKey(holder);
  }
  const initialStart = picks.start ? keyOf(picks.start, "picked-start") : "first";
  return { ends, starts, initialEnd, initialStart };
}
