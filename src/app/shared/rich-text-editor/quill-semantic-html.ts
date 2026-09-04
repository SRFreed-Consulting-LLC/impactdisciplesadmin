import Quill from 'quill';

/**
 * QUILL SERIALISES EVERY SPACE AS `&nbsp;`. This undoes that.
 *
 * THE INCIDENT (2026-09-04, Coaching With Impact). Two sections on that page
 * rendered with their copy off-centre while every other centred section on it
 * sat correctly. Nothing was configured wrong: both columns carried
 * align:'centre' and measure:true, the same pair as the section below them
 * that looked right. Their stored HTML held 108 and 154 `&nbsp;` and NOT ONE
 * ordinary space, which makes a paragraph one unbreakable "word" 718 and 1003
 * characters long. Text that cannot break cannot wrap, so it overflowed the
 * column's measured width instead of laying out inside it.
 *
 * IT LOOKED LIKE A PASTE AND IT IS NOT ONE, which is the part worth writing
 * down because the first diagnosis got it wrong and the wrong fix follows
 * naturally from it. Quill's clipboard ALREADY normalises nbsp on the way in
 * - `matchText` ends with `replaceAll('\u00A0', ' ')` (quill 2.0.3,
 * modules/clipboard.js:472), so paste is not how they arrive. They arrive on
 * the way OUT: `getSemanticHTML()` serialises a text blot as
 * `escapedText.replaceAll(' ', '&nbsp;')` (core/editor.js:298),
 * unconditionally, and ngx-quill's default `format: 'html'` reads the model
 * value through exactly that method. So EVERY save through a Quill editor
 * writes a value whose every space is a non-breaking one, whether the words
 * were pasted, typed, or edited by one character.
 *
 * That is why the damage tracked which fields had been EDITED rather than
 * which had been pasted into, and why the two sections on that page that
 * nobody had touched were clean.
 *
 * WHY A PROTOTYPE WRAP, which is not a thing to do lightly. The value leaves
 * ngx-quill through its `valueGetter` input, which is per-component: fixing
 * it there means the same line on fifteen `<quill-editor>` tags and on every
 * one added afterwards, and the failure mode of forgetting it is silent and
 * ships to a public page. ngx-quill's global QuillConfig has no valueGetter
 * (checked against ngx-quill 28's own config typings), so there is no
 * supported single seam. One wrap of one public method, installed once at
 * startup, covers every editor in the app including the email designer's -
 * and the app already accepts a global Quill config in this folder, for the
 * same "one decision, not fifteen" reason (see quill-style-attributors.ts).
 *
 * EVERY NBSP GOES, including one somebody meant. A real non-breaking space
 * holding "10 km" together is lost, and that is the accepted trade: the two
 * failures are not comparable. An nbsp that becomes a space costs a line
 * break nobody will notice; one that survives can take a page's layout with
 * it, and did.
 *
 * WHAT IS GIVEN UP. Quill uses nbsp partly to preserve a run of spaces or a
 * leading one, which HTML would otherwise collapse. After this, "two  spaces"
 * renders as one. That is how every page on the site already reads, because
 * everything written before Quill was adopted was stored with ordinary
 * spaces.
 */

let installed = false;

/**
 * Wraps `getSemanticHTML` so the value ngx-quill hands to a model carries
 * ordinary spaces.
 *
 * Idempotent - a second call is a no-op rather than a wrap around a wrap,
 * which would be harmless but is the kind of thing that stops being harmless
 * once someone adds a second transform.
 */
export function installQuillSemanticHtmlSpaceFix(): void {
  if (installed) {
    return;
  }
  installed = true;

  const prototype = Quill.prototype as unknown as {
    getSemanticHTML: (...args: unknown[]) => string;
  };
  const original = prototype.getSemanticHTML;

  prototype.getSemanticHTML = function patched(...args: unknown[]): string {
    return unjoinSerialisedSpaces(original.apply(this, args));
  };
}

/**
 * The serialised spaces, back to ordinary ones.
 *
 * Exported for its test, and because it is the whole of what the wrap does -
 * a reader should not have to reason about the patch to know the rule.
 * @param html What getSemanticHTML produced.
 * @return The same HTML with nothing in it that cannot break.
 */
export function unjoinSerialisedSpaces(html: string): string {
  return html.split('&nbsp;').join(' ').split('\u00A0').join(' ');
}
