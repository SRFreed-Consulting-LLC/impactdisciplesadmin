import type Anthropic from "@anthropic-ai/sdk";
import {getStorage} from "firebase-admin/storage";
import {HttpsError} from "firebase-functions/v2/https";
import {logger} from "firebase-functions";
import {BookImportRequest, BookPlan, LessonContent} from "./types";
import {
  IMPORT_SYSTEM_PROMPT,
  buildLessonPrompt,
  buildPlanPrompt,
} from "./prompts";

// Ported from impact-discipleship-library-manager-new's
// functions/src/book-import/importer.ts - a self-contained copy in this
// app's own Cloud Functions, per the consolidation plan's decision to give
// admin its own copy rather than call the manager app's still-running
// function (which is going away, project and all, once this migration is
// done - see that plan's Phase 2 notes).

const DEFAULT_MODEL = "claude-sonnet-4-5";
const MAX_TOKENS = 16000;
// Anthropic's document API caps PDFs at 32MB / 100 pages; surface a clean
// error rather than a raw API failure past that.
const MAX_PDF_BYTES = 32 * 1024 * 1024;

/**
 * Runs one phase of the AI book import. Reads the uploaded PDF from Cloud
 * Storage, sends it to Claude as a cached document block (so the many
 * per-lesson calls reuse the same uploaded PDF cheaply), and returns the
 * parsed block model. Never writes any library content - the client does
 * the Firestore writes after the admin confirms the plan.
 * @param {string} apiKey Anthropic API key.
 * @param {BookImportRequest} request The plan/lesson request payload.
 * @return {Promise<BookPlan | LessonContent>} The parsed result for this
 * phase.
 */
export async function runBookImport(
  apiKey: string,
  request: BookImportRequest
): Promise<BookPlan | LessonContent> {
  if (!request?.storagePath) {
    throw new HttpsError("invalid-argument", "storagePath is required.");
  }
  if (request.mode !== "plan" && request.mode !== "lesson") {
    throw new HttpsError(
      "invalid-argument",
      "mode must be 'plan' or 'lesson'."
    );
  }

  const pdfBase64 = await readPdfAsBase64(request.storagePath);
  // Lazy-loaded rather than a top-level import - see the source function's
  // identical comment on why (avoids loading the whole SDK on every cold
  // start of every function in this deployment, not just this one).
  const {default: AnthropicClient} = await import("@anthropic-ai/sdk");
  const client = new AnthropicClient({apiKey});
  const model = process.env.BOOK_IMPORT_MODEL || DEFAULT_MODEL;

  const prompt =
    request.mode === "plan" ? buildPlanPrompt() : buildLessonPromptFor(request);

  let message;
  try {
    message = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: IMPORT_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: pdfBase64,
              },
              cache_control: {type: "ephemeral"},
            },
            {type: "text", text: prompt},
          ],
        },
      ],
    });
  } catch (err) {
    logger.error("Anthropic request failed", err);
    throw new HttpsError(
      "internal",
      err instanceof Error ?
        `AI request failed: ${err.message}` :
        "AI request failed."
    );
  }

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  const parsed = parseJsonResponse(text);
  if (request.mode === "plan") {
    return normalizePlan(parsed);
  }
  return normalizeLessonContent(parsed);
}

/**
 * Builds the lesson-phase prompt, validating the extra fields lesson mode
 * requires beyond the base request.
 * @param {BookImportRequest} request The lesson-mode request payload.
 * @return {string} The prompt to send to Claude.
 */
function buildLessonPromptFor(request: BookImportRequest): string {
  if (
    !request.plan ||
    typeof request.unitIndex !== "number" ||
    typeof request.lessonIndex !== "number"
  ) {
    throw new HttpsError(
      "invalid-argument",
      "lesson mode requires plan, unitIndex, lessonIndex."
    );
  }
  const {plan, unitIndex, lessonIndex} = request;
  return buildLessonPrompt(plan, unitIndex, lessonIndex);
}

/**
 * Reads the uploaded PDF from Cloud Storage and returns it as base64.
 * @param {string} storagePath Path under book-imports/ the client uploaded to.
 * @return {Promise<string>} The PDF's bytes, base64-encoded.
 */
async function readPdfAsBase64(storagePath: string): Promise<string> {
  // Only ever read from the dedicated upload prefix - a callable is
  // admin-gated, but this keeps a malformed/hostile path from reaching
  // arbitrary objects.
  if (!storagePath.startsWith("book-imports/") || storagePath.includes("..")) {
    throw new HttpsError(
      "invalid-argument",
      "storagePath must be under book-imports/."
    );
  }
  const file = getStorage().bucket().file(storagePath);
  const [exists] = await file.exists();
  if (!exists) {
    throw new HttpsError("not-found", "Uploaded PDF not found in storage.");
  }
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size ?? 0);
  if (size > MAX_PDF_BYTES) {
    const sizeMb = (size / 1024 / 1024).toFixed(1);
    const limitMb = MAX_PDF_BYTES / 1024 / 1024;
    throw new HttpsError(
      "invalid-argument",
      `PDF is ${sizeMb}MB; the ${limitMb}MB limit is exceeded.`
    );
  }
  const [buffer] = await file.download();
  return buffer.toString("base64");
}

/** Strips optional ```json fences and parses. Throws a clean HttpsError on
 *  malformed output rather than leaking a raw SyntaxError.
 * @param {string} text Raw Claude response text.
 * @return {unknown} Parsed JSON value.
 */
function parseJsonResponse(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Last resort: pull the outermost {...} span.
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    throw new HttpsError(
      "internal",
      "AI returned content that was not valid JSON."
    );
  }
}

/**
 * Normalizes/validates a raw parsed plan response into a well-formed
 * BookPlan, coercing missing/malformed optional fields to safe defaults.
 * @param {unknown} value The raw parsed JSON from Claude.
 * @return {BookPlan} The normalized plan.
 */
function normalizePlan(value: unknown): BookPlan {
  const obj = value as Partial<BookPlan> | undefined;
  const book = (obj?.book ?? {}) as BookPlan["book"];
  if (!book.title) {
    throw new HttpsError("internal", "AI plan did not include a book title.");
  }
  const units = Array.isArray(obj?.units) ? obj.units : [];
  return {
    book: {
      title: String(book.title),
      description: book.description ? String(book.description) : undefined,
      author: book.author ? String(book.author) : undefined,
      year: book.year ? String(book.year) : undefined,
    },
    units: units.map((unit) => ({
      title: String(unit?.title ?? "Untitled unit"),
      lessons: (Array.isArray(unit?.lessons) ? unit.lessons : []).map(
        (lesson) => ({
          title: String(lesson?.title ?? "Untitled lesson"),
          hasQuestions: Boolean(lesson?.hasQuestions),
          imageCount: Number.isFinite(lesson?.imageCount) ?
            Number(lesson?.imageCount) :
            0,
          hasDailyReading: Boolean(lesson?.hasDailyReading),
          pageStart: numberOrUndefined(lesson?.pageStart),
          pageEnd: numberOrUndefined(lesson?.pageEnd),
        })
      ),
    })),
  };
}

/**
 * Normalizes/validates a raw parsed lesson-content response.
 * @param {unknown} value The raw parsed JSON from Claude.
 * @return {LessonContent} The normalized lesson content.
 */
function normalizeLessonContent(value: unknown): LessonContent {
  const obj = value as Partial<LessonContent> | undefined;
  const blocks = Array.isArray(obj?.blocks) ? obj.blocks : [];
  return {
    blocks: blocks.filter(
      (block) => block && typeof block === "object" && "kind" in block
    ),
    dailyReading: obj?.dailyReading,
  };
}

/**
 * Coerces a value to a finite number, or undefined if it isn't one.
 * @param {unknown} value The candidate value.
 * @return {number | undefined} The number, or undefined.
 */
function numberOrUndefined(value: unknown): number | undefined {
  return Number.isFinite(value) ? Number(value) : undefined;
}
