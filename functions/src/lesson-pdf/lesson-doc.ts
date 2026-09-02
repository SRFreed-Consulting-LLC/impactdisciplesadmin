/**
 * Projects a lesson's stored Form.io schema plus one reader's saved answers
 * into a flat, printable document model.
 *
 * WHY A SECOND WALKER. The reader app has its own walker
 * (features/lesson/mat-lesson-blocks.ts) that produces an INTERACTIVE block
 * tree - Angular SafeHtml, tab panes, editable grids. This one produces a
 * PRINTED document: tabs become titled sections, inputs become a label with
 * either the reader's answer or space to write. Same input, deliberately
 * different projection. What the two must agree on is the Form.io vocabulary
 * the manager app can author, so the value shapes below are taken from that
 * file and its field component - keep them in step when a component type is
 * added to the builder's palette.
 *
 * An unfinished lesson is not a special case: an unanswered question prints as
 * a blank questionnaire line, so one document serves both as a saved workbook
 * and as a paper copy to work through.
 */
import {HtmlBlock, htmlToBlocks} from "./html-text";

export type DocNode =
  | {kind: "sectionTitle"; text: string}
  | {kind: "html"; blocks: HtmlBlock[]}
  | {kind: "question"; label: string; answer: AnswerView}
  | {kind: "table"; rows: string[][]}
  | {kind: "spacer"};

/** Value shapes mirror MatLessonFieldComponent's reads of data[key]. */
export type AnswerView =
  | {kind: "text"; value: string; lines: number}
  | {kind: "choices"; options: {label: string; chosen: boolean}[]}
  | {kind: "survey"; columns: string[]; rows: {label: string; chosen: string}[]}
  | {kind: "grid"; headers: string[]; rows: string[][]}
  | {kind: "signed"; signed: boolean};

interface RawComponent {
  type?: string;
  key?: string;
  label?: string;
  html?: string;
  content?: string;
  components?: RawComponent[];
  columns?: {components?: RawComponent[]}[];
  rows?: RawComponent[][][];
  values?: {label?: string; value?: unknown}[];
  data?: {values?: {label?: string; value?: unknown}[]};
  questions?: {label?: string; value?: unknown}[];
  hideLabel?: boolean;
  [key: string]: unknown;
}

const TEXTUAL = new Set([
  "textfield", "textarea", "number", "currency", "email", "url", "tel",
  "phoneNumber", "datetime", "day", "time", "tags", "datamap", "password",
]);
const CHOICE = new Set(["radio", "select", "selectboxes", "checkbox"]);
const CONTAINER = new Set([
  "panel", "fieldset", "well", "container", "column",
]);

/**
 * Strips tags from a label, which may carry inline markup from the builder.
 * @param {string} html Label html.
 * @return {string} Plain text.
 */
export function stripTags(html: string): string {
  return htmlToBlocks(html)
    .map((b) => (b.kind === "image" ? "" : b.runs.map((r) => r.text).join("")))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {unknown} value Any stored scalar.
 * @return {string} Printable text, empty when unanswered.
 */
export function scalarText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    return value.map(scalarText).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== false && v !== null &&
        v !== undefined && v !== "")
      .map(([k]) => k)
      .join(", ");
  }
  return String(value);
}

/**
 * Formats one stored answer for print.
 *
 * @param {RawComponent} component The Form.io component.
 * @param {string} type Its resolved type.
 * @param {unknown} value data[key] as saved, possibly undefined.
 * @return {AnswerView} How to print it.
 */
function answerFor(
  component: RawComponent,
  type: string,
  value: unknown
): AnswerView {
  if (type === "signature") {
    return {kind: "signed", signed: typeof value === "string" && !!value};
  }

  if (type === "survey") {
    const values = component.values ?? [];
    const answers = (value ?? {}) as Record<string, string>;
    return {
      kind: "survey",
      columns: values.map((v) => stripTags(String(v.label ?? ""))),
      rows: (component.questions ?? []).map((q) => {
        const chosenValue = answers[String(q.value ?? "")];
        const column = values
          .find((v) => String(v.value ?? "") === chosenValue);
        return {
          label: stripTags(String(q.label ?? "")),
          chosen: column ? stripTags(String(column.label ?? "")) : "",
        };
      }),
    };
  }

  if (type === "datagrid" || type === "editgrid") {
    const children = (component.components ?? []).filter((c) => c.key);
    const saved = Array.isArray(value) ?
      (value as Record<string, unknown>[]) :
      [];
    return {
      kind: "grid",
      headers: children.map((c) => stripTags(String(c.label ?? c.key ?? ""))),
      // Three blank rows when nothing was entered: a header with nothing
      // under it is not something anyone can fill in on paper.
      rows: (saved.length ? saved : [{}, {}, {}]).map((row) =>
        children.map((c) => scalarText(row[String(c.key)]))),
    };
  }

  if (type === "checkbox") {
    return {
      kind: "choices",
      options: [{
        label: stripTags(String(component.label ?? "")),
        chosen: value === true,
      }],
    };
  }

  if (CHOICE.has(type)) {
    // radio/selectboxes read values[]; select reads data.values[] - the same
    // split the reader's own walker documents.
    const raw = type === "select" ?
      component.data?.values ?? [] :
      component.values ?? [];
    const selected = (value ?? {}) as Record<string, boolean>;
    return {
      kind: "choices",
      options: raw.map((option) => {
        const optionValue = String(option.value ?? "");
        return {
          label: stripTags(String(option.label ?? "")),
          chosen: type === "selectboxes" ?
            selected[optionValue] === true :
            scalarText(value) === optionValue,
        };
      }),
    };
  }

  const text = scalarText(value);
  const authoredRows = Number(component["rows"]);
  // Room to write when unanswered: a textarea gets its authored row count,
  // anything else one line.
  const lines = text ?
    0 :
    type === "textarea" ?
      Math.max(3, Number.isFinite(authoredRows) ? authoredRows : 3) :
      1;
  return {kind: "text", value: text, lines};
}

/**
 * Walks a lesson schema into printable nodes.
 *
 * @param {unknown} schema The lesson's stored formSchema.
 * @param {Record<string, unknown>} answers The reader's saved data, if any.
 * @return {DocNode[]} Nodes in document order.
 */
export function buildLessonDoc(
  schema: unknown,
  answers: Record<string, unknown>
): DocNode[] {
  const nodes: DocNode[] = [];
  const root = (schema ?? {}) as RawComponent;
  walk(root.components ?? [], answers, nodes);
  return nodes;
}

/**
 * @param {RawComponent[]} components Components at this level.
 * @param {Record<string, unknown>} answers Saved answers.
 * @param {DocNode[]} out Accumulator.
 */
function walk(
  components: RawComponent[],
  answers: Record<string, unknown>,
  out: DocNode[]
): void {
  for (const component of components) {
    const type = String(component.type ?? "");

    // A Save button has no meaning on paper, and a hidden field is a stored
    // value the reader never sees.
    if (type === "button" || type === "hidden") continue;

    if (type === "content" || type === "htmlelement") {
      const html = String(component.html ?? component.content ?? "");
      if (html.trim()) out.push({kind: "html", blocks: htmlToBlocks(html)});
      continue;
    }

    if (type === "tabs") {
      for (const pane of component.components ?? []) {
        const title = stripTags(String(pane.label ?? ""));
        if (title) out.push({kind: "sectionTitle", text: title});
        walk(pane.components ?? [], answers, out);
      }
      continue;
    }

    if (type === "columns") {
      for (const column of component.columns ?? []) {
        walk(column.components ?? [], answers, out);
      }
      continue;
    }

    if (type === "table") {
      const rows = (component.rows ?? []).map((row) =>
        row.map((cell) => {
          const cellNodes: DocNode[] = [];
          const cellComponents = Array.isArray(cell) ?
            (cell as RawComponent[]) :
            (cell as RawComponent).components ?? [];
          walk(cellComponents, answers, cellNodes);
          return cellNodes
            .map((n) => n.kind === "html" ? htmlText(n.blocks) :
              n.kind === "question" ? n.label : "")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
        }));
      if (rows.length) out.push({kind: "table", rows});
      continue;
    }

    if (CONTAINER.has(type)) {
      const title = stripTags(String(component.label ?? ""));
      if (title && component.hideLabel !== true) {
        out.push({kind: "sectionTitle", text: title});
      }
      walk(component.components ?? [], answers, out);
      continue;
    }

    const key = String(component.key ?? "");
    const isInput = TEXTUAL.has(type) || CHOICE.has(type) ||
      type === "survey" || type === "signature" ||
      type === "datagrid" || type === "editgrid";
    if (!key || !isInput) continue;

    out.push({
      kind: "question",
      label: component.hideLabel === true ?
        "" :
        stripTags(String(component.label ?? "")),
      answer: answerFor(component, type, answers[key]),
    });
    out.push({kind: "spacer"});
  }
}

/**
 * @param {HtmlBlock[]} blocks Parsed html blocks.
 * @return {string} Their combined text.
 */
function htmlText(blocks: HtmlBlock[]): string {
  return blocks
    .map((b) => (b.kind === "image" ? "" : b.runs.map((r) => r.text).join("")))
    .join(" ");
}
