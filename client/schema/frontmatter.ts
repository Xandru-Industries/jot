import { $nodeSchema } from "@milkdown/utils";

type FrontmatterAstNode = { type: string; value?: string };

export function normalizeLineEndings(text: string) {
  return text.replace(/\r\n?/g, "\n");
}

export function normalizeFrontmatterInput(text: string) {
  const normalized = normalizeLineEndings(text);
  if (!normalized.startsWith("---\n")) return normalized;
  return normalized.replace(/^---\n([\s\S]*?)\n\.\.\.(?=\n|$)/, "---\n$1\n---");
}

export function stripFrontmatterDelimiters(text: string) {
  const lines = normalizeLineEndings(text).split("\n");
  if (lines[0]?.trim() !== "---") return lines.join("\n");
  const end = lines.findIndex((line, index) => index > 0 && ["---", "..."].includes(line.trim()));
  return end < 0 ? lines.join("\n") : lines.slice(1, end).join("\n");
}

export const frontmatterSchema = $nodeSchema("frontmatter", () => ({
  group: "block",
  content: "text*",
  marks: "",
  defining: true,
  code: true,
  isolating: true,
  parseDOM: [{ tag: "pre[data-frontmatter]", preserveWhitespace: "full" as const }],
  toDOM: () => ["pre", { "data-frontmatter": "true", class: "frontmatter" }, ["code", 0]],
  parseMarkdown: {
    match: (node) => (node as FrontmatterAstNode).type === "yaml",
    runner: (state, node, type) => {
      state.openNode(type);
      state.addText(`---\n${(node as FrontmatterAstNode).value || ""}\n---`);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "frontmatter",
    runner: (state, node) => state.addNode("yaml", undefined, stripFrontmatterDelimiters(node.textContent)),
  },
}));
