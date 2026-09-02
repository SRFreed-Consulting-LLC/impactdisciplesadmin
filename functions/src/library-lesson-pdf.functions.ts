import {tenantPath} from "./common/shared/lists/tenancy";
const LESSON_IMAGES = tenantPath("lessonImages");
const LIBRARY_USERS = tenantPath("libraryUsers");
/**
 * Emails a reader a PDF of one lesson, with their own saved answers in it.
 *
 * Server-side rather than in the app for three reasons: the licence check has
 * to be authoritative, the recipient must be the caller's own address and not
 * a parameter, and the Android build would otherwise need a PDF engine inside
 * a WebView that cannot even display one.
 *
 * The lesson does NOT have to be finished. Unanswered questions print as blank
 * ruled lines, so the same document works as a completed workbook or as a
 * paper copy to work through.
 */
import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {getFirestore, Timestamp} from "firebase-admin/firestore";
import {
  EmailLessonPdfRequest,
  EmailLessonPdfResult,
} from "./common/shared/contract/library-callables.types";
import {mayReadBook} from "./library-access";
import {exceedsAttachmentLimit} from "./lesson-pdf/limits";
import {buildLessonDoc} from "./lesson-pdf/lesson-doc";
import {renderLessonPdf} from "./lesson-pdf/render-pdf";

const db = getFirestore();

export const emailLessonPdf = onCall(
  // pdfkit plus a lesson's embedded images needs more than the default 256MB,
  // and a long lesson with several diagrams takes real time to lay out.
  {memory: "512MiB", timeoutSeconds: 120},
  async (request): Promise<EmailLessonPdfResult> => {
    const email = request.auth?.token.email?.trim().toLowerCase();
    if (!email) {
      throw new HttpsError("unauthenticated", "Sign in to email a lesson.");
    }

    const {bookId, lessonId} = (request.data ?? {}) as EmailLessonPdfRequest;
    if (!bookId || !lessonId) {
      throw new HttpsError(
        "invalid-argument",
        "bookId and lessonId are required."
      );
    }

    const profileSnap = await db.collection(LIBRARY_USERS).doc(email).get();
    if (!profileSnap.exists) {
      throw new HttpsError("permission-denied", "No reader profile.");
    }
    const profile = profileSnap.data() ?? {};

    // Checked here rather than trusted from the client - this function runs
    // with admin credentials and would otherwise happily mail any lesson in
    // the library to anyone with an account. The rule itself lives in
    // library-access.ts, where it is tested.
    if (!mayReadBook(profile, bookId)) {
      throw new HttpsError(
        "permission-denied",
        "You do not have access to this book."
      );
    }

    const found = await findLesson(bookId, lessonId);
    if (!found) {
      throw new HttpsError("not-found", "That lesson no longer exists.");
    }

    const submissionSnap = await db.collection(LIBRARY_USERS).doc(email)
      .collection("submissions").doc(lessonId).get();
    const answers = (submissionSnap.data()?.["data"] ?? {}) as
      Record<string, unknown>;

    const schema = await hydrateImages(found.lesson["formSchema"]);
    const nodes = buildLessonDoc(schema, answers);

    const readerName = [profile["firstName"], profile["lastName"]]
      .filter(Boolean).join(" ") || email;

    const pdf = await renderLessonPdf({
      bookTitle: String(found.bookTitle ?? ""),
      unitTitle: String(found.unitTitle ?? ""),
      lessonTitle: String(found.lesson["title"] ?? "Lesson"),
      readerName,
      memoryVerse: found.lesson["memoryVerse"] ?
        String(found.lesson["memoryVerse"]) :
        undefined,
    }, nodes);

    const title = String(found.lesson["title"] ?? "lesson");
    const fileName = `${safeName(title)}.pdf`;
    if (exceedsAttachmentLimit(pdf.length)) {
      logger.error("emailLessonPdf too large", {lessonId, bytes: pdf.length});
      throw new HttpsError(
        "resource-exhausted",
        "This lesson is too large to email."
      );
    }
    // Attached inline rather than stored: nothing then lives on afterwards
    // holding this reader's written answers, and there is no signed URL to
    // expire or leak. See MAX_PDF_BYTES for the ceiling that buys.

    await db.collection("mail").add({
      to: email,
      date: Timestamp.now(),
      message: {
        subject: `${title} - Impact Discipleship Library`,
        html: bodyHtml(
          readerName,
          String(found.lesson["title"] ?? "your lesson"),
          String(found.bookTitle ?? "")
        ),
        attachments: [{
          filename: fileName,
          content: pdf.toString("base64"),
          encoding: "base64",
        }],
      },
    });

    logger.info("emailLessonPdf queued",
      {email, bookId, lessonId, bytes: pdf.length});
    return {sentTo: email};
  });

interface FoundLesson {
  lesson: Record<string, unknown>;
  unitTitle: string;
  bookTitle: string;
}

/**
 * Resolves a lesson by book and lesson id.
 *
 * The same shape as the client's findLesson: books live under
 * librarySeries/{s}/books/{b}, so the book is located through the `books`
 * collection group and each of its units is probed for the lesson doc.
 *
 * @param {string} bookId The book the lesson belongs to.
 * @param {string} lessonId The lesson.
 * @return {Promise<FoundLesson|undefined>} The lesson with its titles.
 */
async function findLesson(
  bookId: string,
  lessonId: string
): Promise<FoundLesson | undefined> {
  const books = await db.collectionGroup("books").get();
  const bookDoc = books.docs.find((d) => d.id === bookId);
  if (!bookDoc) return undefined;

  const units = await bookDoc.ref.collection("units").orderBy("order").get();
  for (const unit of units.docs) {
    const lessonSnap = await unit.ref.collection("lessons").doc(lessonId).get();
    if (lessonSnap.exists) {
      return {
        lesson: lessonSnap.data() ?? {},
        unitTitle: String(unit.get("title") ?? ""),
        bookTitle: String(bookDoc.get("title") ?? ""),
      };
    }
  }
  return undefined;
}

/**
 * Replaces `lessonimage:{id}` placeholders with their stored data URIs, the
 * same substitution LessonImageService does in the app before rendering.
 *
 * @param {unknown} schema The raw formSchema.
 * @return {Promise<unknown>} The schema with images inlined.
 */
async function hydrateImages(schema: unknown): Promise<unknown> {
  const json = JSON.stringify(schema ?? {});
  const ids = [...new Set(
    [...json.matchAll(/lessonimage:([A-Za-z0-9_-]+)/g)].map((m) => m[1])
  )];
  if (!ids.length) return schema;

  const snaps = await Promise.all(
    ids.map((id) => db.collection(LESSON_IMAGES).doc(id).get())
  );
  let hydrated = json;
  snaps.forEach((snap, index) => {
    const dataUri = snap.data()?.["dataUri"] ?? snap.data()?.["data"];
    if (typeof dataUri === "string" && dataUri.startsWith("data:")) {
      // JSON.stringify escaped the source; replace inside the same encoding.
      hydrated = hydrated.split(`lessonimage:${ids[index]}`).join(dataUri);
    }
  });
  return JSON.parse(hydrated);
}

/**
 * @param {string} title A lesson title.
 * @return {string} A filename-safe version of it.
 */
function safeName(title: string): string {
  return title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-")
    .slice(0, 60) || "lesson";
}

/**
 * @param {string} name The reader's display name.
 * @param {string} lessonTitle The lesson.
 * @param {string} bookTitle Its book.
 * @return {string} The email body.
 */
function bodyHtml(
  name: string,
  lessonTitle: string,
  bookTitle: string
): string {
  return `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Here is your copy of <strong>${escapeHtml(lessonTitle)}</strong>${
  bookTitle ? ` from ${escapeHtml(bookTitle)}` : ""
}, attached as a PDF.</p>
    <p>Anything you had already written is included. Anything you had not is
    left blank so you can fill it in on paper.</p>
    <p>Impact Discipleship Ministries</p>
  `;
}

/**
 * @param {string} text Untrusted text destined for an html body.
 * @return {string} Escaped text.
 */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[char] as string);
}
