/** One action of the command palette. */
export interface PaletteCommand {
  id: string;
  title: string;
  /** Heading the command is listed under. */
  group: string;
  /** Key or chord shown on the right, e.g. "⌘O" or "g h". */
  shortcut?: string;
  /** Faded text after the title (a hash, a path). */
  detail?: string;
  /** Extra words the command can be found by. */
  keywords?: string;
  run: () => void;
}

/** How well `command` answers `query`: 0 = not at all; higher is better. */
export function scoreCommand(command: PaletteCommand, query: string): number {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  const title = command.title.toLowerCase();
  const haystack = `${title} ${command.group} ${command.keywords ?? ""} ${command.detail ?? ""}`.toLowerCase();
  let score = 0;
  for (const word of words) {
    if (!haystack.includes(word)) return 0;
    if (title.startsWith(word)) score += 4;
    else if (new RegExp(`(^|[\\s/:._-])${escape(word)}`).test(title)) score += 3;
    else if (title.includes(word)) score += 2;
    else score += 1;
  }
  return score;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The commands matching `query`, best first; ties keep their order. Every one for an empty query. */
export function rankCommands(commands: readonly PaletteCommand[], query: string, limit = 200): PaletteCommand[] {
  if (query.trim() === "") return commands.slice(0, limit);
  return commands
    .map((command, order) => ({ command, order, score: scoreCommand(command, query) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((c) => c.command);
}

/** Commands split into their groups, groups in order of their first command. */
export function groupCommands(commands: readonly PaletteCommand[]): Array<{ group: string; commands: PaletteCommand[] }> {
  const groups = new Map<string, PaletteCommand[]>();
  for (const command of commands) {
    const list = groups.get(command.group);
    if (list) list.push(command);
    else groups.set(command.group, [command]);
  }
  return [...groups].map(([group, list]) => ({ group, commands: list }));
}
