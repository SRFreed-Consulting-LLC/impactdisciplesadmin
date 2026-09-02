/**
 * Lays the printable document model out as a PDF.
 *
 * Uses pdfkit's built-in Helvetica/Times faces rather than shipping the app's
 * own webfonts: the standard 14 need no font files in the deploy bundle, and
 * this document is meant to read and print as a workbook, not to reproduce the
 * app's theme (see lesson-doc.ts for that decision).
 */
import PDFDocument = require("pdfkit");
import {AnswerView, DocNode} from "./lesson-doc";
import {TextRun} from "./html-text";

const PAGE_MARGIN = 56;
const BODY_SIZE = 11;
const LINE_GAP = 3;
const RULE_GREY = "#c9c4b8";
const SOFT_INK = "#5c554b";

export interface LessonPdfHeader {
  bookTitle: string;
  unitTitle: string;
  lessonTitle: string;
  readerName: string;
  memoryVerse?: string;
}

/**
 * Renders the document to a PDF buffer.
 *
 * @param {LessonPdfHeader} header Titles for the cover block.
 * @param {DocNode[]} nodes The lesson body.
 * @return {Promise<Buffer>} The finished PDF.
 */
export function renderLessonPdf(
  header: LessonPdfHeader,
  nodes: DocNode[]
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "LETTER",
    margins: {
      top: PAGE_MARGIN, bottom: PAGE_MARGIN,
      left: PAGE_MARGIN, right: PAGE_MARGIN,
    },
    info: {
      Title: header.lessonTitle,
      Author: "Impact Discipleship Ministries",
    },
    // Required by writeFooters: switchToPage can only revisit pages that were
    // buffered, and the page COUNT is not known until the body is laid out.
    // Without this the footers silently never appear.
    bufferPages: true,
  });

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  writeHeader(doc, header);
  for (const node of nodes) writeNode(doc, node);
  writeFooters(doc);

  doc.end();
  return done;
}

/** @return {number} The printable width between margins. */
function contentWidth(doc: PDFKit.PDFDocument): number {
  return doc.page.width - PAGE_MARGIN * 2;
}

/**
 * @param {PDFKit.PDFDocument} doc Target document.
 * @param {number} needed Height the next element wants.
 */
function ensureRoom(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > doc.page.height - PAGE_MARGIN) doc.addPage();
}

/**
 * @param {PDFKit.PDFDocument} doc Target document.
 * @param {LessonPdfHeader} header Titles.
 */
function writeHeader(
  doc: PDFKit.PDFDocument,
  header: LessonPdfHeader
): void {
  doc.font("Helvetica").fontSize(9).fillColor(SOFT_INK)
    .text(header.bookTitle.toUpperCase(), {characterSpacing: 1});
  if (header.unitTitle) {
    doc.font("Helvetica").fontSize(9).fillColor(SOFT_INK)
      .text(header.unitTitle.toUpperCase(), {characterSpacing: 1});
  }
  doc.moveDown(0.4);
  doc.font("Times-Bold").fontSize(22).fillColor("black")
    .text(header.lessonTitle);
  doc.moveDown(0.3);
  if (header.memoryVerse) {
    doc.font("Times-Italic").fontSize(11).fillColor(SOFT_INK)
      .text(header.memoryVerse);
    doc.moveDown(0.3);
  }
  doc.font("Helvetica").fontSize(9).fillColor(SOFT_INK)
    .text(header.readerName);
  doc.moveDown(0.6);
  rule(doc);
  doc.moveDown(0.8);
  doc.fillColor("black");
}

/**
 * @param {PDFKit.PDFDocument} doc Target document.
 */
function rule(doc: PDFKit.PDFDocument): void {
  doc.save().strokeColor(RULE_GREY).lineWidth(1)
    .moveTo(PAGE_MARGIN, doc.y)
    .lineTo(doc.page.width - PAGE_MARGIN, doc.y)
    .stroke().restore();
}

/**
 * @param {PDFKit.PDFDocument} doc Target document.
 * @param {DocNode} node One printable node.
 */
function writeNode(doc: PDFKit.PDFDocument, node: DocNode): void {
  switch (node.kind) {
  case "spacer":
    doc.moveDown(0.5);
    return;

  case "sectionTitle":
    ensureRoom(doc, 60);
    doc.moveDown(0.6);
    doc.font("Helvetica-Bold").fontSize(13).fillColor("black")
      .text(node.text);
    doc.moveDown(0.2);
    rule(doc);
    doc.moveDown(0.5);
    return;

  case "html":
    for (const block of node.blocks) {
      if (block.kind === "image") {
        writeImage(doc, block.dataUri);
        continue;
      }
      const isList = block.kind === "listItem";
      const heading = block.kind === "paragraph" ? block.heading : undefined;
      ensureRoom(doc, 40);
      if (heading) {
        doc.moveDown(0.4);
        writeRuns(doc, block.runs, {
          size: heading === 1 ? 15 : heading === 2 ? 13 : 12,
          forceBold: true,
        });
        doc.moveDown(0.2);
      } else if (isList) {
        const marker = block.ordinal ? `${block.ordinal}.` : "•";
        const indent = 18;
        const startY = doc.y;
        doc.font("Helvetica").fontSize(BODY_SIZE).fillColor("black")
          .text(marker, PAGE_MARGIN, startY, {width: indent});
        doc.y = startY;
        writeRuns(doc, block.runs, {indent});
      } else {
        writeRuns(doc, block.runs, {});
        doc.moveDown(0.35);
      }
    }
    return;

  case "table":
    writeTable(doc, node.rows[0] ?? [], node.rows.slice(1));
    return;

  case "question":
    writeQuestion(doc, node.label, node.answer);
    return;
  }
}

/**
 * Writes a run of styled inline text as one flowing paragraph.
 *
 * @param {PDFKit.PDFDocument} doc Target document.
 * @param {TextRun[]} runs The inline pieces.
 * @param {object} opts Size, forced weight and left indent.
 */
function writeRuns(
  doc: PDFKit.PDFDocument,
  runs: TextRun[],
  opts: {size?: number; forceBold?: boolean; indent?: number}
): void {
  const size = opts.size ?? BODY_SIZE;
  const indent = opts.indent ?? 0;
  const width = contentWidth(doc) - indent;
  const x = PAGE_MARGIN + indent;

  runs.forEach((run, index) => {
    const bold = opts.forceBold || run.bold;
    const face = bold && run.italic ? "Times-BoldItalic" :
      bold ? "Helvetica-Bold" :
        run.italic ? "Times-Italic" : "Helvetica";
    doc.font(face).fontSize(size).fillColor("black");
    // continued keeps the whole paragraph on one flow so wrapping happens
    // across the runs rather than restarting per run.
    const last = index === runs.length - 1;
    if (index === 0) {
      doc.text(run.text, x, doc.y,
        {width, lineGap: LINE_GAP, continued: !last});
    } else {
      doc.text(run.text, {width, lineGap: LINE_GAP, continued: !last});
    }
  });
  if (!runs.length) doc.moveDown(0.3);
}

/**
 * @param {PDFKit.PDFDocument} doc Target document.
 * @param {string} dataUri A data: image from the lesson content.
 */
function writeImage(doc: PDFKit.PDFDocument, dataUri: string): void {
  // pdfkit decodes PNG and JPEG only. An SVG diagram (a few lessons carry
  // them) is skipped rather than throwing and losing the whole document.
  if (!/^data:image\/(png|jpe?g);base64,/i.test(dataUri)) return;
  try {
    const base64 = dataUri.slice(dataUri.indexOf(",") + 1);
    const buffer = Buffer.from(base64, "base64");
    const width = Math.min(contentWidth(doc), 380);
    ensureRoom(doc, 140);
    doc.moveDown(0.3);
    doc.image(buffer, {fit: [width, 320], align: "center"});
    doc.moveDown(0.6);
  } catch {
    // A corrupt image must not cost the reader their whole lesson.
  }
}

/**
 * @param {PDFKit.PDFDocument} doc Target document.
 * @param {string} label The question text.
 * @param {AnswerView} answer How it was answered, if at all.
 */
function writeQuestion(
  doc: PDFKit.PDFDocument,
  label: string,
  answer: AnswerView
): void {
  ensureRoom(doc, 70);
  if (label) {
    doc.font("Helvetica-Bold").fontSize(BODY_SIZE).fillColor("black")
      .text(label, PAGE_MARGIN, doc.y, {
        width: contentWidth(doc), lineGap: LINE_GAP,
      });
    doc.moveDown(0.3);
  }

  switch (answer.kind) {
  case "text":
    writeAnswerBox(doc, answer.value, answer.lines);
    return;

  case "choices":
    for (const option of answer.options) {
      ensureRoom(doc, 20);
      const y = doc.y;
      drawCheckbox(doc, PAGE_MARGIN + 6, y + 2, option.chosen);
      doc.font("Helvetica").fontSize(BODY_SIZE).fillColor("black")
        .text(option.label, PAGE_MARGIN + 24, y, {
          width: contentWidth(doc) - 24, lineGap: LINE_GAP,
        });
    }
    return;

  case "survey":
    writeTable(
      doc,
      ["", ...answer.columns],
      answer.rows.map((row) => [
        row.label,
        ...answer.columns.map((column) => row.chosen === column ? "X" : ""),
      ])
    );
    return;

  case "grid":
    writeTable(doc, answer.headers, answer.rows);
    return;

  case "signed":
    if (answer.signed) {
      doc.font("Times-Italic").fontSize(BODY_SIZE).fillColor(SOFT_INK)
        .text("Signed in the app", PAGE_MARGIN + 12, doc.y);
      doc.fillColor("black");
    } else {
      writeAnswerBox(doc, "", 1);
    }
    return;
  }
}

/**
 * Draws a checkbox as vector art.
 *
 * NOT a glyph. The standard PDF faces are WinAnsi-encoded and that encoding
 * has no box and no checkmark anywhere in it, so U+25A1 / U+25A0 came out as
 * whatever each viewer chose to substitute. Two lines and a rectangle render
 * identically everywhere and need no embedded font.
 *
 * @param {PDFKit.PDFDocument} doc Target document.
 * @param {number} x Left edge.
 * @param {number} y Top edge.
 * @param {boolean} checked Whether to tick it.
 */
function drawCheckbox(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  checked: boolean
): void {
  const size = 9;
  doc.save();
  doc.lineWidth(0.9).strokeColor(checked ? "black" : RULE_GREY)
    .rect(x, y, size, size).stroke();
  if (checked) {
    doc.lineWidth(1.4).strokeColor("black").lineJoin("round")
      .moveTo(x + 1.9, y + 4.8)
      .lineTo(x + 3.7, y + 6.7)
      .lineTo(x + 7.3, y + 2.3)
      .stroke();
  }
  doc.restore();
}

/** Height of one handwriting line inside a blank answer box. */
const WRITE_LINE = 22;
const BOX_PAD = 8;
const BOX_INDENT = 12;

/**
 * Draws the answer area for a written question.
 *
 * Boxed whether or not it was answered, so a half-finished lesson still reads
 * as one document rather than two interleaved ones. An answered box holds the
 * reader's own words; a blank box holds faint rules to write on, which a bare
 * outline does not give you and loose lines with no border do not frame.
 *
 * @param {PDFKit.PDFDocument} doc Target document.
 * @param {string} value What the reader wrote, empty when unanswered.
 * @param {number} lines Handwriting lines to leave when it is empty.
 */
function writeAnswerBox(
  doc: PDFKit.PDFDocument,
  value: string,
  lines: number
): void {
  const x = PAGE_MARGIN + BOX_INDENT;
  const width = contentWidth(doc) - BOX_INDENT;
  const innerWidth = width - BOX_PAD * 2;

  const textHeight = value ?
    doc.font("Times-Roman").fontSize(BODY_SIZE)
      .heightOfString(value, {width: innerWidth, lineGap: LINE_GAP}) :
    0;
  const height = value ?
    textHeight + BOX_PAD * 2 :
    Math.max(1, lines) * WRITE_LINE + BOX_PAD;

  const pageRoom = doc.page.height - PAGE_MARGIN * 2;
  if (height > pageRoom) {
    // Longer than a whole page: a box would clip it, and losing what someone
    // wrote is far worse than losing its border.
    doc.font("Times-Roman").fontSize(BODY_SIZE).fillColor("black")
      .text(value, x, doc.y, {width, lineGap: LINE_GAP});
    doc.moveDown(0.3);
    return;
  }
  ensureRoom(doc, height + 4);

  const top = doc.y;
  doc.save().strokeColor(RULE_GREY).lineWidth(0.75)
    .rect(x, top, width, height).stroke();

  if (value) {
    doc.restore();
    doc.font("Times-Roman").fontSize(BODY_SIZE).fillColor("black")
      .text(value, x + BOX_PAD, top + BOX_PAD, {
        width: innerWidth, lineGap: LINE_GAP,
      });
  } else {
    // Rules sit INSIDE the border and stop short of it on both sides, so they
    // read as guides rather than as a grid.
    for (let index = 1; index <= Math.max(1, lines); index++) {
      const y = top + index * WRITE_LINE;
      if (y >= top + height - 2) break;
      doc.moveTo(x + BOX_PAD, y).lineTo(x + width - BOX_PAD, y).stroke();
    }
    doc.restore();
  }

  doc.y = top + height;
  doc.moveDown(0.3);
}

/**
 * A plain grid. Column widths are equal - the content is short labels and
 * short answers, and measuring for a balanced layout is not worth the
 * complexity here.
 *
 * @param {PDFKit.PDFDocument} doc Target document.
 * @param {string[]} headers Header cells; skipped when all are empty.
 * @param {string[][]} rows Body rows.
 */
function writeTable(
  doc: PDFKit.PDFDocument,
  headers: string[],
  rows: string[][]
): void {
  const columnCount = Math.max(headers.length,
    ...rows.map((r) => r.length), 1);
  const width = contentWidth(doc) / columnCount;
  const padding = 5;

  const writeRow = (cells: string[], bold: boolean) => {
    const heights = cells.map((cell) =>
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9)
        .heightOfString(cell || " ", {width: width - padding * 2}));
    const height = Math.max(18, ...heights) + padding * 2;
    ensureRoom(doc, height);
    const top = doc.y;
    doc.save().strokeColor(RULE_GREY).lineWidth(0.75);
    for (let index = 0; index < columnCount; index++) {
      const x = PAGE_MARGIN + width * index;
      doc.rect(x, top, width, height).stroke();
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9)
        .fillColor("black")
        .text(cells[index] ?? "", x + padding, top + padding,
          {width: width - padding * 2});
    }
    doc.restore();
    doc.y = top + height;
  };

  doc.moveDown(0.2);
  if (headers.some((h) => h.trim())) writeRow(headers, true);
  for (const row of rows) writeRow(row, false);
  doc.moveDown(0.4);
}

/**
 * Numbers every page once the body is laid out.
 * @param {PDFKit.PDFDocument} doc Target document.
 */
function writeFooters(doc: PDFKit.PDFDocument): void {
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index++) {
    doc.switchToPage(range.start + index);
    doc.font("Helvetica").fontSize(8).fillColor(SOFT_INK)
      .text(
        `Impact Discipleship Library     ${index + 1} of ${range.count}`,
        PAGE_MARGIN,
        doc.page.height - PAGE_MARGIN + 16,
        {width: contentWidth(doc), align: "center", lineBreak: false}
      );
  }
}
