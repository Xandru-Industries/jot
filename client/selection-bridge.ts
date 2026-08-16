import type { Node as ProseNode } from "@milkdown/prose/model";

export type Affinity = "left" | "right";
export type ProseMirrorSelection = { anchor: number; head: number };
export type SourceSelection = { start: number; end: number; direction: "none" | "forward" | "backward" };

type SourceUnit = {
  kind: "text" | "atom";
  value: string;
  start: number;
  end: number;
};

type ProseUnit = {
  kind: "text" | "atom";
  value: string;
  from: number;
  to: number;
};

type PairedUnit = SourceUnit & { from: number; to: number };

function closingBracket(markdown: string, start: number, open: string, close: string) {
  let depth = 0;
  for (let index = start; index < markdown.length; index++) {
    if (markdown[index] === "\\") {
      index++;
      continue;
    }
    if (markdown[index] === open) depth++;
    if (markdown[index] === close && --depth === 0) return index;
  }
  return -1;
}

function sourceUnits(markdown: string): SourceUnit[] {
  const units: SourceUnit[] = [];
  let index = 0;
  let lineStart = true;

  while (index < markdown.length) {
    if (lineStart) {
      const prefix = markdown.slice(index).match(/^(?: {0,3}#{1,6}[ \t]+| {0,3}>[ \t]?| {0,3}(?:[-+*]|\d+[.)])[ \t]+)/)?.[0];
      if (prefix) index += prefix.length;
      lineStart = false;
      if (index >= markdown.length) break;
    }

    const character = markdown[index];
    if (character === "\n" || character === "\r") {
      if (character === "\r" && markdown[index + 1] === "\n") index++;
      index++;
      lineStart = true;
      continue;
    }

    if (character === "!" && markdown[index + 1] === "[") {
      const labelEnd = closingBracket(markdown, index + 1, "[", "]");
      const destinationEnd = labelEnd >= 0 && markdown[labelEnd + 1] === "("
        ? closingBracket(markdown, labelEnd + 1, "(", ")")
        : -1;
      if (destinationEnd >= 0) {
        units.push({ kind: "atom", value: markdown.slice(index + 2, labelEnd), start: index, end: destinationEnd + 1 });
        index = destinationEnd + 1;
        continue;
      }
    }

    if (character === "[") {
      const labelEnd = closingBracket(markdown, index, "[", "]");
      const destinationEnd = labelEnd >= 0 && markdown[labelEnd + 1] === "("
        ? closingBracket(markdown, labelEnd + 1, "(", ")")
        : -1;
      if (destinationEnd >= 0) {
        index++;
        while (index < labelEnd) {
          units.push({ kind: "text", value: markdown[index], start: index, end: index + 1 });
          index++;
        }
        index = destinationEnd + 1;
        continue;
      }
    }

    if (character === "`" || character === "~" || character === "*" || character === "_") {
      const run = markdown.slice(index).match(character === "`" ? /^`+/ : character === "~" ? /^~~/ : new RegExp(`^\\${character}{1,2}`))?.[0];
      if (run) {
        index += run.length;
        continue;
      }
    }

    if (character === "\\" && index + 1 < markdown.length) {
      index++;
      units.push({ kind: "text", value: markdown[index], start: index, end: index + 1 });
      index++;
      continue;
    }

    units.push({ kind: "text", value: character, start: index, end: index + 1 });
    index++;
  }
  return units;
}

function proseUnits(doc: ProseNode): ProseUnit[] {
  const units: ProseUnit[] = [];
  doc.descendants((node, position) => {
    if (node.isText) {
      const text = node.text || "";
      for (let index = 0; index < text.length; index++) {
        units.push({ kind: "text", value: text[index], from: position + index, to: position + index + 1 });
      }
      return false;
    }
    if (node.isInline && node.isAtom) {
      units.push({ kind: "atom", value: String(node.attrs.alt || node.attrs.title || ""), from: position, to: position + node.nodeSize });
      return false;
    }
    return true;
  });
  return units;
}

function pairUnits(markdown: string, doc: ProseNode): PairedUnit[] {
  const source = sourceUnits(markdown);
  const prose = proseUnits(doc);
  const paired: PairedUnit[] = [];
  let sourceIndex = 0;
  for (const unit of prose) {
    while (sourceIndex < source.length) {
      const candidate = source[sourceIndex++];
      if (candidate.kind === unit.kind && (unit.kind === "atom" || candidate.value === unit.value)) {
        paired.push({ ...candidate, from: unit.from, to: unit.to });
        break;
      }
    }
  }
  return paired;
}

export class SelectionBridge {
  revision = 0;
  private markdown = "";
  private doc: ProseNode;
  private units: PairedUnit[] = [];
  private markdownCache = new Map<string, number>();
  private proseCache = new Map<string, number>();

  constructor(markdown: string, doc: ProseNode) {
    this.markdown = markdown;
    this.doc = doc;
    this.rebuild();
  }

  invalidate(revision: number, markdown = this.markdown, doc = this.doc) {
    this.revision = revision;
    this.markdown = markdown;
    this.doc = doc;
    this.rebuild();
  }

  private rebuild() {
    this.units = pairUnits(this.markdown, this.doc);
    this.markdownCache.clear();
    this.proseCache.clear();
  }

  private sourceOffset(position: number, affinity: Affinity) {
    const cacheKey = `${position}:${affinity}`;
    const cached = this.markdownCache.get(cacheKey);
    if (cached !== undefined) return cached;
    let previous: PairedUnit | undefined;
    let next: PairedUnit | undefined;
    for (const unit of this.units) {
      if (unit.to <= position) previous = unit;
      if (!next && unit.from >= position) next = unit;
      if (unit.from < position && position < unit.to) {
        const result = unit.kind === "atom"
          ? affinity === "left" ? unit.start : unit.end
          : unit.start + Math.min(position - unit.from, unit.end - unit.start);
        this.markdownCache.set(cacheKey, result);
        return result;
      }
    }
    const result = affinity === "left" ? previous?.end ?? 0 : next?.start ?? this.markdown.length;
    this.markdownCache.set(cacheKey, result);
    return result;
  }

  private prosePosition(offset: number) {
    const clamped = Math.max(0, Math.min(offset, this.markdown.length));
    const cacheKey = String(clamped);
    const cached = this.proseCache.get(cacheKey);
    if (cached !== undefined) return cached;
    if (!this.units.length) return 1;
    for (const unit of this.units) {
      if (unit.kind === "atom" && clamped >= unit.start && clamped <= unit.end) {
        const result = clamped <= unit.start ? unit.from : unit.to;
        this.proseCache.set(cacheKey, result);
        return result;
      }
      if (clamped < unit.start) {
        this.proseCache.set(cacheKey, unit.from);
        return unit.from;
      }
      if (clamped <= unit.end) {
        const result = unit.from + Math.min(clamped - unit.start, unit.to - unit.from);
        this.proseCache.set(cacheKey, result);
        return result;
      }
    }
    const result = this.units.at(-1)?.to ?? 1;
    this.proseCache.set(cacheKey, result);
    return result;
  }

  toMarkdown(selection: ProseMirrorSelection, affinity: { anchor: Affinity; head: Affinity } = { anchor: "left", head: "right" }): SourceSelection {
    const anchor = this.sourceOffset(selection.anchor, affinity.anchor);
    const head = this.sourceOffset(selection.head, affinity.head);
    return {
      start: Math.min(anchor, head),
      end: Math.max(anchor, head),
      direction: anchor === head ? "none" : anchor > head ? "backward" : "forward",
    };
  }

  toProseMirror(selection: SourceSelection): ProseMirrorSelection {
    const start = this.prosePosition(selection.start);
    const end = this.prosePosition(selection.end);
    return selection.direction === "backward" ? { anchor: end, head: start } : { anchor: start, head: end };
  }
}
