import {
  createCssVariablesTheme,
  createHighlighterCore,
  type HighlighterCore,
  type LanguageRegistration,
  type ThemedToken,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type { Hunk } from "../../lib/bindings";

type LanguageModule = { default: LanguageRegistration[] };

/** Grammars are loaded the first time a file of that language is shown. */
const LANGUAGES: Record<string, () => Promise<LanguageModule>> = {
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  vue: () => import("shiki/langs/vue.mjs"),
};

const BY_EXTENSION: Record<string, string> = {
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
  json: "json", jsonc: "json", css: "css", scss: "scss", html: "html", htm: "html",
  md: "markdown", markdown: "markdown", rs: "rust", py: "python", go: "go",
  java: "java", kt: "kotlin", swift: "swift", c: "c", h: "c",
  cc: "cpp", cpp: "cpp", hpp: "cpp", cs: "csharp", php: "php", rb: "ruby",
  sh: "shellscript", bash: "shellscript", zsh: "shellscript",
  yml: "yaml", yaml: "yaml", toml: "toml", sql: "sql", xml: "xml", svg: "xml", vue: "vue",
};

/** Shiki language id for a file path, or null when there is no grammar for it. */
export function languageFor(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  return BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null;
}

const THEME = "css-variables";
let highlighter: Promise<HighlighterCore> | null = null;
const loaded = new Set<string>();

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [createCssVariablesTheme({ name: THEME, variablePrefix: "--shiki-", variableDefaults: {}, fontStyle: true })],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighter;
}

/** Tokens for each line of `lines`, or null when the language is unknown or loading failed. */
export async function highlightLines(path: string, lines: string[]): Promise<ThemedToken[][] | null> {
  const lang = languageFor(path);
  const load = lang ? LANGUAGES[lang] : undefined;
  if (!lang || !load || lines.length === 0) return null;
  try {
    const shiki = await getHighlighter();
    if (!loaded.has(lang)) {
      await shiki.loadLanguage(...(await load()).default);
      loaded.add(lang);
    }
    return shiki.codeToTokensBase(lines.join("\n"), { lang, theme: THEME });
  } catch (error) {
    console.warn("syntax highlighting failed", error);
    return null;
  }
}

/** Tokens for every line of every hunk, indexed `[hunk][line]`. */
export type HunkTokens = Array<Array<ThemedToken[] | undefined>>;

/**
 * Highlights each hunk as two code blocks, the old side (context + deletions) and the new side
 * (context + additions), so multi-line constructs inside a hunk are tokenised in context.
 */
export async function highlightHunks(path: string, hunks: Hunk[]): Promise<HunkTokens | null> {
  const result: HunkTokens = [];
  for (const hunk of hunks) {
    const oldSide = hunk.lines.filter((l) => l.kind !== "Add");
    const newSide = hunk.lines.filter((l) => l.kind !== "Del");
    const [oldTokens, newTokens] = await Promise.all([
      highlightLines(path, oldSide.map((l) => l.text)),
      highlightLines(path, newSide.map((l) => l.text)),
    ]);
    if (!oldTokens && !newTokens) return null;

    let o = 0;
    let n = 0;
    result.push(
      hunk.lines.map((line) => {
        if (line.kind === "Del") return oldTokens?.[o++];
        if (line.kind === "Add") return newTokens?.[n++];
        o++;
        return newTokens?.[n++];
      }),
    );
  }
  return result;
}
