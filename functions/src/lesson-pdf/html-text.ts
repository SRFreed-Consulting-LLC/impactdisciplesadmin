/**
 * Turns the staff-authored HTML inside a lesson's content components into a
 * flat list of styled paragraphs a PDF writer can lay out.
 *
 * WHY NOT AN HTML LIBRARY. There is no DOM in a Cloud Function, and the
 * alternative - rendering the real page with headless Chrome - was weighed and
 * rejected: it is a very large dependency with slow cold starts, for a document
 * that is meant to read as a printed workbook rather than as a screenshot of
 * the app. The markup here is not arbitrary web content either; it comes from
 * one Form.io editor in the manager app, so the tag vocabulary is small and
 * known. Anything outside it degrades to its text rather than disappearing.
 *
 * The output is intentionally dumb: paragraphs of runs, plus images and list
 * items. No nesting, no floats, no tables - tables arrive as their own Form.io
 * component and are handled in lesson-doc.ts.
 */

export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export type HtmlBlock =
  | {kind: "paragraph"; runs: TextRun[]; heading?: 1 | 2 | 3}
  | {kind: "listItem"; runs: TextRun[]; ordinal?: number}
  | {kind: "image"; dataUri: string};

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  mdash: "—", ndash: "–", hellip: "…", middot: "·",
};

/**
 * Decodes the entity subset the lesson content actually uses.
 * @param {string} text Raw text between tags.
 * @return {string} Decoded text.
 */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_m, code: string) =>
      String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) =>
      String.fromCodePoint(parseInt(code, 16)))
    .replace(/&(\w+);/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(ENTITIES, name) ?
        ENTITIES[name] :
        match);
}

const BLOCK_END = /^(p|div|h[1-6]|li|ul|ol|figure|figcaption|blockquote|tr)$/;
const HEADING = /^h([1-6])$/;

/**
 * Parses lesson HTML into printable blocks.
 *
 * @param {string} html The stored content html.
 * @return {HtmlBlock[]} Blocks in document order; empty for empty input.
 */
export function htmlToBlocks(html: string): HtmlBlock[] {
  const blocks: HtmlBlock[] = [];
  let runs: TextRun[] = [];
  let bold = 0;
  let italic = 0;
  let heading: 1 | 2 | 3 | undefined;
  let listDepth = 0;
  let ordered = false;
  let ordinal = 0;
  let inListItem = false;

  const flush = () => {
    const text = runs.map((r) => r.text).join("");
    if (text.trim()) {
      if (inListItem) {
        blocks.push({
          kind: "listItem",
          runs,
          ...(ordered ? {ordinal: ++ordinal} : {}),
        });
      } else {
        blocks.push({kind: "paragraph", runs, ...(heading ? {heading} : {})});
      }
    }
    runs = [];
    heading = undefined;
  };

  // One pass over tags and the text between them. Scripts and styles never
  // appear in this content, so there is no need to suppress their bodies.
  const pattern = /<\/?([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    const between = html.slice(cursor, match.index);
    if (between) {
      const text = decodeEntities(between).replace(/\s+/g, " ");
      if (text) runs.push({text, bold: bold > 0, italic: italic > 0});
    }
    cursor = pattern.lastIndex;

    const tag = match[1].toLowerCase();
    const attrs = match[2] || "";
    const closing = match[0].startsWith("</");

    if (tag === "img") {
      const src = /src\s*=\s*"([^"]*)"|src\s*=\s*'([^']*)'/.exec(attrs);
      const uri = src ? src[1] ?? src[2] : "";
      // Only embedded images survive: a remote URL would mean a network fetch
      // per image while a reader waits, and lesson art is stored inline
      // anyway (LessonImageService hydrates lessonimage:{id} to a data URI).
      if (uri.startsWith("data:image/")) {
        flush();
        blocks.push({kind: "image", dataUri: uri});
      }
      continue;
    }

    if (tag === "br") {
      flush();
      continue;
    }

    if (tag === "b" || tag === "strong") {
      bold += closing ? -1 : 1;
      if (bold < 0) bold = 0;
      continue;
    }
    if (tag === "i" || tag === "em") {
      italic += closing ? -1 : 1;
      if (italic < 0) italic = 0;
      continue;
    }

    if (tag === "ul" || tag === "ol") {
      flush();
      if (closing) {
        listDepth = Math.max(0, listDepth - 1);
        if (listDepth === 0) {
          ordered = false;
          ordinal = 0;
        }
      } else {
        listDepth++;
        ordered = tag === "ol";
        ordinal = 0;
      }
      continue;
    }

    if (tag === "li") {
      flush();
      inListItem = !closing;
      continue;
    }

    const headingMatch = HEADING.exec(tag);
    if (headingMatch && !closing) {
      flush();
      // h4-h6 all print at the smallest heading size; the lessons only use
      // three visual levels and inventing more would not read as a hierarchy.
      const level = Number(headingMatch[1]);
      heading = (level > 3 ? 3 : level) as 1 | 2 | 3;
      continue;
    }

    if (BLOCK_END.test(tag)) {
      flush();
      if (tag !== "li") inListItem = false;
    }
  }

  const trailing = html.slice(cursor);
  if (trailing) {
    const text = decodeEntities(trailing).replace(/\s+/g, " ");
    if (text.trim()) runs.push({text, bold: bold > 0, italic: italic > 0});
  }
  flush();

  return blocks;
}
