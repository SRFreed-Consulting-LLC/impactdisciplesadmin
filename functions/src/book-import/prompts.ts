import {BookPlan} from "./types";

// Ported verbatim from impact-discipleship-library-manager-new's
// functions/src/book-import/prompts.ts. Prompts for the two AI phases. Both
// ask Claude to return ONLY strict JSON matching the block model in
// types.ts. The system prompt establishes the domain (a discipleship
// curriculum: Series > Book > Units > Lessons) so the structure Claude
// picks matches how staff author these books by hand.

export const IMPORT_SYSTEM_PROMPT = `You convert a discipleship book PDF into
a structured curriculum for an
admin library app. The hierarchy is: Series > Book > Units > Lessons. A Unit is
a major section/part/week; a Lesson is a single day/chapter/study within it. A
Lesson may be "interactive" - it contains questions the reader answers and
submits. Many lessons also have a "Discussion" or "Leading Group Discussion"
section meant for a group, distinct from the personal-study body.

Rules you must always follow:
- Return ONLY valid JSON. No markdown, no prose, no code fences.
- Preserve the author's wording verbatim in content; do not summarize, rewrite,
  paraphrase, or add commentary of your own.
- Do NOT invent questions. Only mark content as a "question" block when the
  source actually asks the reader something to answer (a prompt with space to
  respond, a numbered study question, a fill-in, a reflection prompt). Narrative
  or rhetorical sentences inside body copy are NOT questions.
- A lesson has questions ONLY if it genuinely asks the reader to respond. Front
  matter, tables of contents, prefaces, and pure-narrative chapters have none.
- Ignore page headers/footers, page numbers, and running titles.`;

/**
 * Phase 1: structure only.
 * @return {string} The plan-phase prompt.
 */
export function buildPlanPrompt(): string {
  return `Read the entire attached PDF and produce a PLAN of its structure
as JSON of exactly this shape:

{
  "book": {
    "title": string, "description": string, "author": string, "year": string
  },
  "units": [
    {
      "title": string,
      "lessons": [
        {
          "title": string,
          "hasQuestions": boolean,
          "imageCount": number,
          "hasDailyReading": boolean,
          "pageStart": number,
          "pageEnd": number
        }
      ]
    }
  ]
}

Guidance:
- "description": 1-3 sentence distillation of the book, in the author's spirit.
- "author"/"year": omit the field (or use "") if not clearly stated.
- Group lessons into their natural units. If the book has no explicit unit
  structure, create a single unit titled after the book, or sensible groupings
  (e.g. by week) if that is how it reads.
- "imageCount": count distinct diagrams/illustrations/charts in each lesson
  (not decorative rules or the publisher logo). 0 if none.
- "hasDailyReading": true only if the lesson has an explicit weekday
  devotional reading plan / memory verse schedule.
- "pageStart"/"pageEnd": 1-based inclusive PDF page range for the lesson.
- Titles must be the real titles from the book, not invented labels.`;
}

/**
 * Phase 2: full content for one lesson.
 * @param {BookPlan} plan The already-generated plan, for title/page context.
 * @param {number} unitIndex Index of the unit within plan.units.
 * @param {number} lessonIndex Index of the lesson within the unit's lessons.
 * @return {string} The lesson-phase prompt.
 */
export function buildLessonPrompt(
  plan: BookPlan,
  unitIndex: number,
  lessonIndex: number
): string {
  const unit = plan.units[unitIndex];
  const lesson = unit?.lessons[lessonIndex];
  const pageHint =
    lesson?.pageStart && lesson?.pageEnd ?
      `It is on PDF pages ${lesson.pageStart}-${lesson.pageEnd}.` :
      "";
  return `From the attached PDF, transcribe the FULL content of this one lesson:

Unit: "${unit?.title ?? ""}"
Lesson: "${lesson?.title ?? ""}"
${pageHint}

Return JSON of exactly this shape:

{
  "blocks": [
    { "kind": "heading", "text": string,
      "section": "lesson" | "discussion" },
    { "kind": "content", "html": string,
      "section": "lesson" | "discussion" },
    { "kind": "question", "prompt": string,
      "inputType": "textarea" | "textfield",
      "section": "lesson" | "discussion" },
    { "kind": "image", "page": number, "alt": string, "caption": string,
      "section": "lesson" | "discussion" }
  ],
  "dailyReading": {
    "goal": string, "memoryVerse": string,
    "monVerse": string, "tueVerse": string, "wedVerse": string,
    "thuVerse": string, "friVerse": string
  }
}

Guidance:
- Emit blocks in reading order.
- "content".html: clean semantic HTML for the body copy - use <p>, <strong>,
  <em>, <ul>/<li>, <blockquote> as the text warrants. Preserve scripture
  references and quotations exactly. Do not include <img> tags (use image
  blocks). Do not include inline styles or classes.
- "heading": a section title within the lesson (e.g. "Introduction",
  "Digging Deeper", "Leading Group Discussion").
- "question": ONE per answerable prompt. Put the question text in "prompt".
  Use "textarea" for anything expecting more than a few words, "textfield" for
  a name/word/short answer.
- "section": "discussion" for blocks that belong to the group-discussion part
  of the lesson; "lesson" (the default) for the personal-study body. Only use
  "discussion" if the lesson clearly separates such a section.
- "image": one block per diagram, with the 1-based PDF "page" it is on and a
  short "alt"/"caption". The image bytes are handled separately.
- "dailyReading": include ONLY if this lesson has an explicit weekday reading
  plan; otherwise omit the whole "dailyReading" key. "goal" is the week's aim;
  "memoryVerse" the verse reference; monVerse..friVerse the daily readings.
- Transcribe everything in the lesson; do not truncate or summarize.`;
}
