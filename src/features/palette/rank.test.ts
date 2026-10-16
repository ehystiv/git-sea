import { describe, expect, it } from "vitest";
import { groupCommands, rankCommands, scoreCommand, type PaletteCommand } from "./rank";

const command = (id: string, title: string, group = "Vista", keywords?: string): PaletteCommand => ({ id, title, group, keywords, run: () => undefined });

const commands = [
  command("graph", "Mostra il grafo", "Vista", "graph"),
  command("timeline", "Mostra la timeline", "Vista"),
  command("open", "Apri repository…", "Repository", "open folder"),
  command("main", "Vai a main", "Riferimenti"),
  command("only-main", "Mostra solo main", "Filtro"),
];

describe("scoreCommand", () => {
  it("needs every word somewhere, and prefers the start of the title", () => {
    expect(scoreCommand(commands[0] as PaletteCommand, "graph")).toBeGreaterThan(0);
    expect(scoreCommand(commands[0] as PaletteCommand, "grafo timeline")).toBe(0);
    expect(scoreCommand(commands[3] as PaletteCommand, "vai")).toBeGreaterThan(scoreCommand(commands[3] as PaletteCommand, "main"));
  });
});

describe("rankCommands", () => {
  it("returns everything in order for an empty query", () => {
    expect(rankCommands(commands, " ").map((c) => c.id)).toEqual(["graph", "timeline", "open", "main", "only-main"]);
  });

  it("filters and sorts, ties keep their order", () => {
    expect(rankCommands(commands, "main").map((c) => c.id)).toEqual(["main", "only-main"]);
    expect(rankCommands(commands, "mostra").map((c) => c.id)).toEqual(["graph", "timeline", "only-main"]);
    expect(rankCommands(commands, "folder").map((c) => c.id)).toEqual(["open"]);
    expect(rankCommands(commands, "filtro").map((c) => c.id)).toEqual(["only-main"]);
    expect(rankCommands(commands, "zzz")).toEqual([]);
  });

  it("stops at the limit", () => {
    expect(rankCommands(commands, "", 2)).toHaveLength(2);
  });
});

describe("groupCommands", () => {
  it("keeps the groups in order of first appearance", () => {
    const groups = groupCommands([commands[3], commands[0], commands[4], commands[1]] as PaletteCommand[]);
    expect(groups.map((g) => [g.group, g.commands.length])).toEqual([
      ["Riferimenti", 1],
      ["Vista", 2],
      ["Filtro", 1],
    ]);
  });
});
