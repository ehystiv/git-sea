import type { HeadInfo } from "../../lib/bindings";

/** The commit HEAD points to, or null for a repository without commits. */
export function headCommitId(head: HeadInfo): string | null {
  return head.kind === "Unborn" ? null : head.commit;
}
