import { RICH_TEXT_PASTE_MATCHERS, stripPastedInkOnPaste } from './quill-paste-cleanup';

// A matcher over a plain object - no TestBed, no Quill. The only thing about
// a Delta these read is `ops`, so a literal is the whole fixture.
//
// The nbsp half of this incident is NOT tested here, because it is not fixed
// here - see quill-semantic-html.spec.ts. Quill's own clipboard already
// normalises nbsp on the way in.

/** The Delta shape the matcher sees. Built by hand for the same reason the
 *  matcher declares it rather than importing it - see the source file. */
function delta(ops: { insert?: unknown; attributes?: Record<string, unknown> }[]) {
  return { ops } as Parameters<typeof stripPastedInkOnPaste>[1];
}

/** The matcher reads neither the node nor the scroll. */
const NODE = {} as Node;
const SCROLL = {};

describe('stripPastedInkOnPaste', () => {
  it('drops the colour and background a paste brought with it', () => {
    const out = stripPastedInkOnPaste(
      NODE,
      delta([{
        insert: 'words',
        attributes: { color: 'rgb(34, 34, 34)', background: 'rgb(255, 255, 255)' }
      }]),
      SCROLL
    );

    // The attributes key goes entirely rather than becoming {} - see the
    // comment on the matcher.
    expect(out.ops).toEqual([{ insert: 'words' }]);
  });

  it('keeps structure while dropping decoration', () => {
    const out = stripPastedInkOnPaste(
      NODE,
      delta([{
        insert: 'Kevin Burrell',
        attributes: {
          bold: true,
          link: '/team-details/AP4yP449P3iI7L0PsOVp',
          color: 'rgb(34, 34, 34)'
        }
      }]),
      SCROLL
    );

    expect(out.ops).toEqual([{
      insert: 'Kevin Burrell',
      attributes: { bold: true, link: '/team-details/AP4yP449P3iI7L0PsOVp' }
    }]);
  });

  it('leaves an op with no attributes untouched', () => {
    expect(stripPastedInkOnPaste(NODE, delta([{ insert: 'plain' }]), SCROLL).ops)
      .toEqual([{ insert: 'plain' }]);
  });

  it('leaves an op whose only formatting is structural untouched', () => {
    const op = { insert: 'heading', attributes: { header: 2 } };

    expect(stripPastedInkOnPaste(NODE, delta([op]), SCROLL).ops).toEqual([op]);
  });
});

describe('RICH_TEXT_PASTE_MATCHERS', () => {
  // The selector is what decides whether the matcher ever runs: Quill sorts
  // matchers into text and element buckets by this value alone, and a wrong
  // one is silent - the matcher is simply never called.
  it('registers the ink strip against element nodes', () => {
    expect(RICH_TEXT_PASTE_MATCHERS).toEqual([[Node.ELEMENT_NODE, stripPastedInkOnPaste]]);
  });
});
