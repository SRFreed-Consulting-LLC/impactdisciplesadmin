/**
 * THE DECORATION A PASTE BRINGS WITH IT, dropped before it can be stored.
 *
 * FROM THE SAME INCIDENT as quill-semantic-html.ts (2026-09-04, Coaching With
 * Impact), and this is the HALF THAT REALLY WAS THE PASTE. Read that file
 * first: the joined-up words that broke the page's layout came from Quill's
 * own serialiser on save, not from the clipboard, and a matcher here would
 * not have prevented them. The colours did come from the clipboard.
 *
 * WHAT THE STORED PARAGRAPHS CARRIED. Sixteen declarations of
 * `background-color: rgb(255, 255, 255); color: rgb(34, 34, 34)` per field -
 * the ink of whatever page the copy was lifted from, faithfully reproduced by
 * Quill because this app deliberately registers the style attributors (see
 * quill-style-attributors.ts) so formatting survives into email. That
 * decision is right for email and wrong for a site page, and paste is where
 * the difference can be told: a colour somebody CHOSE arrives through the
 * toolbar, and a colour that merely came along arrives through the clipboard.
 *
 * NOTE THERE IS NO NBSP MATCHER HERE, deliberately, and it is the second
 * thing a reader will look for. Quill 2.0.3's own `matchText` already ends
 * with `replaceAll('\u00A0', ' ')` (modules/clipboard.js:472), so one would
 * be a no-op dressed up as a safeguard - which is worse than nothing, because
 * the next person to read it would believe the paste path was covered.
 *
 * SCOPE. This hangs off RICH_TEXT_TOOLBAR, so every editor using the shared
 * toolbar gets it - the page section editor, content pieces, Web Config,
 * products, DMMs, the team page, coaches, events and the campaign popup
 * editor. The email designer's inline editor builds its own modules object
 * and is deliberately NOT covered: pasted colour is far likelier to be wanted
 * in an email than on a page. Verified rather than assumed - Quill merges
 * module options into a fresh object (core/quill.js:520), so passing matchers
 * to one instance does not leak them into Clipboard.DEFAULTS and thence into
 * every editor built afterwards.
 */

/**
 * A Delta operation, as far as this file needs to care.
 *
 * Declared rather than imported from `quill-delta`: it is a transitive
 * dependency of quill rather than one this app declares, and a type import
 * would be the only thing tying us to its version.
 */
interface DeltaOp {
  insert?: string | Record<string, unknown>;
  attributes?: Record<string, unknown>;
}

/** The shape of the Delta a matcher is handed. Same reasoning as DeltaOp. */
interface MatchedDelta {
  ops: DeltaOp[];
}

/** Quill's matcher signature (see node_modules/quill/modules/clipboard.d.ts).
 *  `scroll` is untyped here because none of these matchers reads it. */
type ClipboardMatcher = (node: Node, delta: MatchedDelta, scroll: unknown) => MatchedDelta;

/**
 * The formats a paste may not bring with it.
 *
 * These are Quill's own attribute names for the two style attributors this
 * app registers (see quill-style-attributors.ts), NOT the CSS properties -
 * `background`, not `background-color`.
 */
const PASTED_INK_ATTRIBUTES: readonly string[] = ['color', 'background'];

/**
 * The colours a paste brought with it, dropped.
 *
 * WHAT THIS IS ACTUALLY PROTECTING. A section is drawn on a `surface` - light,
 * dark, the brand tint, over a photo - and the ink follows the ground it is
 * on. Copy carrying `color: rgb(34, 34, 34)` from the page it was lifted from
 * ignores that, so the same words that read correctly on white are unreadable
 * the moment somebody switches the band to dark. `background-color:
 * rgb(255, 255, 255)` is worse: it paints a white highlight behind the words
 * on any ground that is not already white, which is what the Coaching page's
 * copy carried.
 *
 * IT ALSO STRIPS A COLOUR COPIED FROM OUR OWN EDITOR, because a matcher
 * cannot tell where a clipboard came from. That is the deliberate half of the
 * trade: the toolbar still has both colour buttons, so re-applying a colour
 * someone meant is one click, whereas finding a stray inherited one in stored
 * HTML is what this incident cost. Structure survives - bold, italic, links,
 * headings, lists - and only the decoration goes.
 */
export const stripPastedInkOnPaste: ClipboardMatcher = (_node, delta) => {
  delta.ops = delta.ops.map((op) => {
    if (!op.attributes) {
      return op;
    }
    // Named and filtered rather than destructured-and-spread: the rest-sibling
    // idiom (`const { color, background, ...kept }`) says the same thing in
    // one line but reads to eslint as two unused variables, and turning that
    // rule off app-wide to keep a one-liner is a poor trade.
    const kept: Record<string, unknown> = {};
    for (const key of Object.keys(op.attributes)) {
      if (!PASTED_INK_ATTRIBUTES.includes(key)) {
        kept[key] = op.attributes[key];
      }
    }
    // An op whose ONLY attributes were the dropped ones loses the key
    // entirely rather than carrying an empty object - Quill treats `{}` and
    // absent the same, but the stored delta is cleaner and the specs read
    // straight.
    return Object.keys(kept).length ? { ...op, attributes: kept } : { insert: op.insert };
  });
  return delta;
};

/**
 * The matchers, in the shape Quill's clipboard module takes them.
 *
 * It must run AFTER the built-in matchers, since it edits what they produced,
 * and passing it as `clipboard.matchers` is what guarantees that - Quill
 * concatenates custom matchers onto its own defaults rather than replacing
 * them (CLIPBOARD_CONFIG.concat, modules/clipboard.js:36).
 *
 * A LIST OF ONE, and it stays a list: the shape is Quill's, and the next
 * thing a paste turns out to carry belongs beside this rather than inside it.
 */
export const RICH_TEXT_PASTE_MATCHERS: [number, ClipboardMatcher][] = [
  [Node.ELEMENT_NODE, stripPastedInkOnPaste]
];
