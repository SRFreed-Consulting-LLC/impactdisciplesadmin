import { ContentPieceComponent, stripTags } from './content-piece.component';
import { ContentPiece } from '@impact-common/shared/models/domain/page-content.model';
import { CONTENT_PIECES } from '@impact-common/shared/lists/section_kit';

/**
 * THE PIECE EDITOR.
 *
 * Hand-constructed rather than TestBed'd: nothing here needs an injector or a
 * rendered template, and the house style is to keep the framework out of the
 * failure path when it earns nothing.
 *
 * The template's own coverage is the WEB suite's piece-coverage spec - what
 * matters there is whether a piece DRAWS, which this side cannot see.
 */
describe('the content piece editor', () => {
  function make(piece: Partial<ContentPiece> = {}): ContentPieceComponent {
    const component = new ContentPieceComponent();
    component.piece = { key: 'p1', kind: 'heading', isActive: true, ...piece } as ContentPiece;
    return component;
  }

  it('knows which controls every kind in the registry uses', () => {
    // The registry drives the menu AND this editor. A kind offered in the
    // menu whose definition cannot be resolved here would add a piece that
    // opens as an empty box.
    const unresolved = CONTENT_PIECES
      .filter((def) => !make({ kind: def.kind }).def);

    expect(unresolved.map((d) => d.kind))
      .withContext('these kinds are offered but have no definition to edit by')
      .toEqual([]);
  });

  it('says so rather than drawing an empty box for a kind it does not know', () => {
    // The data outlives the build: a piece written by a later version has to
    // survive being opened by this one, unchanged.
    const component = make({ kind: 'somethingLater' as never });
    expect(component.def).toBeUndefined();
    expect(component.fields).toEqual({});
  });

  it('summarises a piece so a column of eight is readable closed', () => {
    expect(make({ kind: 'heading', text: 'Our Vision' }).summary).toBe('Our Vision');
    expect(make({ kind: 'text', html: '<p>Hello <b>there</b></p>' }).summary).toBe('Hello there');
    expect(make({
      kind: 'buttons',
      buttons: [{ title: 'Give', isActive: true }, { title: 'Read', isActive: true }]
    }).summary).toBe('Give, Read');
  });

  it('adds as many buttons as asked for, never a fixed one or two', () => {
    // The old fields were ctaTitle/ctaUrl plus a hand-added second pair,
    // which is why a band could never offer three.
    const component = make({ kind: 'buttons' });
    component.addButton();
    component.addButton();
    component.addButton();

    expect(component.buttons.length).toBe(3);
  });

  it('removes the button that was asked for, not the one beside it', () => {
    const component = make({
      kind: 'buttons',
      buttons: [
        { title: 'First', isActive: true },
        { title: 'Second', isActive: true },
        { title: 'Third', isActive: true }
      ]
    });

    component.removeButton(1);

    expect(component.buttons.map((b) => b.title)).toEqual(['First', 'Third']);
  });

  it('treats a giving destination as a key, never as a typed address', () => {
    // SECURITY. A free-text URL here would let anyone who can edit a page
    // redirect donations, and the page would look entirely right.
    const component = make({ kind: 'buttons' });

    expect(component.isGiving({ title: 'Give monthly', link: 'monthly', isActive: true })).toBe(true);
    expect(component.isGiving({ title: 'Give', link: 'https://evil.test', isActive: true }))
      .withContext('an arbitrary address was treated as a known giving destination')
      .toBe(false);
  });

  it('emits a change for every control a CDK overlay swallows', () => {
    // A Material select renders its options OUTSIDE this component, so
    // nothing bubbles from it - an edit made there would never reach the
    // preview or the save. This is the check for that whole class of bug.
    const component = make({ kind: 'buttons' });
    let changes = 0;
    component.changed.subscribe(() => changes++);

    component.addButton();
    component.removeButton(0);

    expect(changes).toBe(2);
  });
});

describe('the closed-row summary of a passage', () => {
  it('reads the words rather than the markup', () => {
    expect(stripTags('<p>Some <em>words</em>&nbsp;here</p>')).toBe('Some words here');
  });

  it('cuts a long passage rather than letting one row become the page', () => {
    const long = stripTags(`<p>${'word '.repeat(60)}</p>`);
    expect(long.length).toBeLessThanOrEqual(91);
    expect(long.endsWith('…')).toBe(true);
  });
});
