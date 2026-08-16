// Deterministically assembles a Form.io lesson schema from the AI import
// block model. Ported from impact-discipleship-library-manager-new's
// core/services/book-schema-assembler.util.ts - see that file's own header
// comment for the full rationale (exact DE1/DMC component shapes,
// interactivity-only-when-questions rule).

import DOMPurify from 'dompurify';
import { LibraryFormioComponent, LibraryFormioSchema } from 'src/app/common/models/domain/library/library-lesson.model';
import { LibraryImportBlock, LibraryLessonContent } from 'src/app/common/models/domain/library/library-book-import.model';

// 'content' blocks are the one case where the AI import prompt deliberately
// asks the model for real markup, unlike heading/question/image blocks
// (plain text, escaped via escapeHtml below) - sanitized instead, since the
// model reads a whole admin-uploaded PDF and could be prompt-injected into
// emitting unsafe markup in a content block. See the source util's own
// comment for the full explanation.
function sanitizeContentHtml(html: string): string {
  return DOMPurify.sanitize(html);
}

export interface LibraryAssembledLesson {
  schema: LibraryFormioSchema;
  /** How many image placeholders were inserted - the lesson is "flagged" for
   *  manual image work when this is > 0. */
  imagePlaceholderCount: number;
}

/** Builds the Form.io schema for one lesson from its block model. */
export function assembleLibraryLessonSchema(content: LibraryLessonContent): LibraryAssembledLesson {
  const usedKeys = new Set<string>();
  const counters = { image: 0 };

  const lessonBlocks = content.blocks.filter((b) => (b.section ?? 'lesson') !== 'discussion');
  const discussionBlocks = content.blocks.filter((b) => b.section === 'discussion');

  const lessonComponents = buildSectionComponents('lesson', lessonBlocks, usedKeys, counters);
  const discussionComponents = buildSectionComponents('discussion', discussionBlocks, usedKeys, counters);

  let components: LibraryFormioComponent[];
  if (discussionComponents.length > 0) {
    // Tabbed layout (Lesson + Discussion), matching the DE1 shape.
    components = [
      {
        key: uniqueKey('tabs', usedKeys),
        type: 'tabs',
        label: 'Tabs',
        components: [
          { key: 'lesson', label: 'Lesson', components: lessonComponents },
          { key: 'discussion', label: 'Discussion', components: discussionComponents },
        ],
      },
    ];
  } else {
    // No discussion section -> keep it flat, like a simple devotional lesson.
    components = lessonComponents;
  }

  return {
    schema: { display: 'form', components },
    imagePlaceholderCount: counters.image,
  };
}

/** Turns one section's blocks into components, appending a single Save/submit
 *  button when (and only when) the section contains a question. */
function buildSectionComponents(
  section: 'lesson' | 'discussion',
  blocks: LibraryImportBlock[],
  usedKeys: Set<string>,
  counters: { image: number },
): LibraryFormioComponent[] {
  const components: LibraryFormioComponent[] = [];
  let hasQuestion = false;

  for (const block of blocks) {
    switch (block.kind) {
      case 'heading':
        components.push(contentComponent(section, headingHtml(block.text), usedKeys));
        break;
      case 'content':
        components.push(contentComponent(section, sanitizeContentHtml(block.html), usedKeys));
        break;
      case 'question': {
        hasQuestion = true;
        components.push(contentComponent(section, questionPromptHtml(block.prompt), usedKeys));
        components.push(answerComponent(section, block.inputType, usedKeys));
        break;
      }
      case 'image':
        counters.image += 1;
        components.push(
          contentComponent(section, imagePlaceholderHtml(block.page, block.caption ?? block.alt), usedKeys),
        );
        break;
    }
  }

  if (hasQuestion) {
    components.push(saveButton(section, usedKeys));
  }
  return components;
}

// ---- Component builders (exact DE1/DMC shapes) ---------------------------

function contentComponent(section: string, html: string, usedKeys: Set<string>): LibraryFormioComponent {
  return {
    key: uniqueKey(`${section}Content`, usedKeys),
    type: 'content',
    label: 'Content',
    html,
  };
}

function answerComponent(
  section: string,
  inputType: 'textarea' | 'textfield',
  usedKeys: Set<string>,
): LibraryFormioComponent {
  if (inputType === 'textfield') {
    return {
      key: uniqueKey(`${section}Answer`, usedKeys),
      type: 'textfield',
      label: 'Answer',
    };
  }
  return {
    key: uniqueKey(`${section}Answer`, usedKeys),
    type: 'textarea',
    label: 'Answer',
    rows: 6,
    autoExpand: false,
  };
}

/** The Save button real lessons use - deliberately NOT the reserved default
 *  `{ key:'submit', label:'Submit' }`, which the app strips as auto-injected. */
function saveButton(section: string, usedKeys: Set<string>): LibraryFormioComponent {
  return {
    key: uniqueKey(`${section}Save`, usedKeys),
    type: 'button',
    label: 'Save',
    action: 'submit',
    theme: 'primary',
    size: 'md',
    block: true,
  };
}

// ---- HTML helpers --------------------------------------------------------

function headingHtml(text: string): string {
  return `<p><span class="text-big"><strong>${escapeHtml(text)}</strong></span></p>`;
}

function questionPromptHtml(prompt: string): string {
  return `<p><strong>${escapeHtml(prompt)}</strong></p>`;
}

/** Image extraction isn't done in the Cloud Function, so an image becomes a
 *  clearly-marked placeholder the admin replaces in the Lesson Editor. */
function imagePlaceholderHtml(page: number, caption: string | undefined): string {
  const note = caption ? `: ${escapeHtml(caption)}` : '';
  return `<p><em>[Image from PDF page ${page} — add in the editor${note}]</em></p>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Appends 2, 3, ... on collision so every key in the schema is unique. */
function uniqueKey(base: string, usedKeys: Set<string>): string {
  let key = base;
  let n = 2;
  while (usedKeys.has(key)) {
    key = `${base}${n++}`;
  }
  usedKeys.add(key);
  return key;
}
