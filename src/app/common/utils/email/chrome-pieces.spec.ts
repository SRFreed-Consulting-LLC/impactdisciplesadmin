import {
  CHROME_FOOTERS,
  CHROME_HEADERS,
  CHROME_PIECES,
  chromePieceById
} from './chrome-pieces';
import { ARCHIVE_SHELLS } from './archive-shells';
import { STARTER_TEMPLATES } from './starter-templates';
import { compileEmailDesign } from './email-design-compiler';
import { createDefaultDesign } from 'src/app/common/models/admin/email-design.model';
import { renderMergeTags } from './merge-tags';

// A chrome piece is dragged onto a design an admin is already editing, so the
// failure modes are different from a starter's: a piece that shares block
// objects between drags corrupts the second one silently, and a piece
// carrying an unresolvable merge tag prints raw in a customer's inbox.
describe('CHROME_PIECES', () => {
  it('has unique ids', () => {
    const ids = CHROME_PIECES.map((piece) => piece.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('splits every archive shell into a header AND a footer', () => {
    for (const shell of ARCHIVE_SHELLS) {
      expect(chromePieceById(`${shell.id}-header`)).withContext(shell.id).toBeTruthy();
      expect(chromePieceById(`${shell.id}-footer`)).withContext(shell.id).toBeTruthy();
    }
    // 2 per shell, plus the two hand-built transactional pieces.
    expect(CHROME_PIECES.length).toBe(ARCHIVE_SHELLS.length * 2 + 2);
  });

  it('offers a transactional option in BOTH positions', () => {
    // The reason this file exists: the Amazon shipping confirmation needed a
    // masthead, and newsletter chrome is the wrong answer for a receipt.
    expect(CHROME_HEADERS.some((p) => p.family === 'transactional')).toBe(true);
    expect(CHROME_FOOTERS.some((p) => p.family === 'transactional')).toBe(true);
  });

  it('partitions cleanly into headers and footers', () => {
    expect(CHROME_HEADERS.length + CHROME_FOOTERS.length).toBe(CHROME_PIECES.length);
  });

  it('names and describes every piece', () => {
    for (const piece of CHROME_PIECES) {
      expect(piece.name.length).withContext(piece.id).toBeGreaterThan(0);
      expect(piece.description.length).withContext(piece.id).toBeGreaterThan(0);
    }
  });

  for (const piece of CHROME_PIECES) {
    describe(piece.name, () => {
      it('builds a one-column row with at least one block', () => {
        const row = piece.build();
        expect(row.columns.length).toBe(1);
        expect(row.columns[0].blocks.length).toBeGreaterThan(0);
      });

      it('builds a FRESH row every call - no shared blocks or ids', () => {
        // Two drags of the same chip must not hand out the same objects, or
        // editing the second one silently edits the first.
        const a = piece.build();
        const b = piece.build();
        expect(a.id).not.toBe(b.id);
        expect(a.columns[0].id).not.toBe(b.columns[0].id);
        expect(a.columns[0].blocks[0].id).not.toBe(b.columns[0].blocks[0].id);
        expect(a.columns[0].blocks[0]).not.toBe(b.columns[0].blocks[0]);
      });

      it('compiles to non-empty html inside a real design', () => {
        const design = createDefaultDesign();
        const target = piece.kind === 'header' ? 0 : 2;
        design.sections[target].rows = [piece.build()];
        const html = compileEmailDesign(design);
        expect(html.length).toBeGreaterThan(0);
      });

      it('carries no merge tag that renders raw to a customer', () => {
        const design = createDefaultDesign();
        design.sections[piece.kind === 'header' ? 0 : 2].rows = [piece.build()];
        // An empty context is the honest test: these pieces land on send
        // paths that supply nothing for chrome. *|BRAND_ADDRESS|* is the one
        // survivor by design - the designer substitutes it at DROP time from
        // the config doc, so it never reaches a saved design.
        const rendered = renderMergeTags(compileEmailDesign(design), {})
          .replace(/\*\|BRAND_ADDRESS\|\*/g, '');
        expect(rendered).withContext(piece.id).not.toMatch(/\*\|/);
      });
    });
  }
});

describe('STARTER_TEMPLATES built from chrome pieces', () => {
  // buildArchiveShell now composes CHROME_PIECES rather than rebuilding the
  // rows, so the shell starters must still come out whole.
  const shellStarters = STARTER_TEMPLATES.filter((starter) =>
    ARCHIVE_SHELLS.some((shell) => shell.id === starter.id));

  it('still covers every archive shell', () => {
    expect(shellStarters.length).toBe(ARCHIVE_SHELLS.length);
  });

  for (const starter of shellStarters) {
    it(`${starter.name} keeps a populated header and footer`, () => {
      const design = starter.build();
      expect(design.sections[0].rows.length).toBe(1);
      expect(design.sections[2].rows.length).toBe(1);
      expect(design.sections[0].rows[0].columns[0].blocks.length).toBeGreaterThan(0);
      expect(design.sections[2].rows[0].columns[0].blocks.length).toBeGreaterThan(0);
    });
  }
});
