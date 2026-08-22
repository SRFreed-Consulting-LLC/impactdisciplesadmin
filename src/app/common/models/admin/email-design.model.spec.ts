import {
  BlockStyles,
  EMAIL_DESIGN_VERSION,
  EmailDesign,
  ZERO_SIDES,
  createDefaultDesign,
  createDesignFromFullHtml,
  createDesignFromLegacyHtml,
  createRow,
  createSection,
  normalizeDesign,
  resolveMobileGlobalStyles,
  resolveMobileStyles,
} from './email-design.model';

// Pure structure and import logic - no TestBed, no DI (house style, see
// permission.service.spec.ts).
//
// This model is the storage contract behind the campaign email editor added
// 2026-08-21: a touch stores builder JSON in `design` and its `html` is
// recompiled from it on every save. So a silent change here does not just
// break the editor's canvas, it changes what actually goes out in an email.

describe('email-design.model', () => {
  describe('createDefaultDesign', () => {
    it('stamps the current schema version', () => {
      expect(createDefaultDesign().version).toBe(EMAIL_DESIGN_VERSION);
    });

    it('lays out header, body and footer in that order', () => {
      expect(createDefaultDesign().sections.map((s) => s.kind))
        .toEqual(['header', 'body', 'footer']);
    });

    it('starts with no rows anywhere, and a 600px content width', () => {
      const design = createDefaultDesign();
      expect(design.contentWidth).toBe(600);
      expect(design.sections.every((s) => s.rows.length === 0)).toBeTrue();
    });

    it('gives each design its own section objects', () => {
      const a = createDefaultDesign();
      const b = createDefaultDesign();
      a.sections[0].name = 'renamed';
      expect(b.sections[0].name).toBeNull();
      expect(a.sections[0].id).not.toBe(b.sections[0].id);
    });
  });

  describe('createRow', () => {
    it('splits width evenly across the requested columns', () => {
      expect(createRow(2).columns.map((c) => c.widthPercent)).toEqual([50, 50]);
      expect(createRow(4).columns.map((c) => c.widthPercent)).toEqual([25, 25, 25, 25]);
    });

    it('clamps to between one and four columns', () => {
      // Four is the ceiling the builder's canvas is laid out for; asking
      // for more must not produce a row it cannot render.
      expect(createRow(0).columns.length).toBe(1);
      expect(createRow(-3).columns.length).toBe(1);
      expect(createRow(9).columns.length).toBe(4);
    });

    it('honours explicit widths when they match the column count', () => {
      expect(createRow(2, [70, 30]).columns.map((c) => c.widthPercent)).toEqual([70, 30]);
    });

    it('ignores explicit widths that do not match the column count', () => {
      // A mismatched array would leave columns with undefined widths, which
      // compiles to a broken table - fall back to an even split instead.
      expect(createRow(3, [70, 30]).columns.map((c) => c.widthPercent)).toEqual([100 / 3, 100 / 3, 100 / 3]);
    });

    it('starts every column empty and gives each its own id', () => {
      const row = createRow(3);
      expect(row.columns.every((c) => c.blocks.length === 0)).toBeTrue();
      expect(new Set(row.columns.map((c) => c.id)).size).toBe(3);
    });
  });

  describe('createSection', () => {
    it('defaults the name to null rather than undefined', () => {
      // normalizeDesign backfills null, and the compiler reads it - an
      // undefined here would be a Firestore write error (see strip-undefined).
      expect(createSection('body').name).toBeNull();
    });

    it('keeps a name when given one', () => {
      expect(createSection('header', 'Masthead').name).toBe('Masthead');
    });
  });

  describe('normalizeDesign', () => {
    // Backfills fields added after a design was saved, so the editor and
    // compiler never meet undefined structure. Older stored designs are the
    // real input here, which is why the fixture omits the newer fields.
    function legacyDesign(): EmailDesign {
      return {
        version: 1,
        contentWidth: 600,
        globalStyles: { desktop: {}, mobile: {} },
        sections: [
          {
            id: 's1', kind: 'body', backgroundColor: null,
            rows: [
              {
                id: 'r1',
                styles: {} as BlockStyles,
                mobileStyles: {},
                stylesLinked: true,
                columns: [
                  {
                    id: 'c1', widthPercent: 100,
                    blocks: [{ id: 'b1', type: 'text', props: { html: 'hi' }, styles: {} } as never],
                  },
                ],
              },
            ],
          },
        ],
      } as unknown as EmailDesign;
    }

    it('backfills a null preheader', () => {
      expect(normalizeDesign(legacyDesign()).preheader).toBeNull();
    });

    it('backfills section names', () => {
      expect(normalizeDesign(legacyDesign()).sections[0].name).toBeNull();
    });

    it('backfills row and block margins with a zeroed box', () => {
      const design = normalizeDesign(legacyDesign());
      const row = design.sections[0].rows[0];
      expect(row.styles.margin).toEqual(ZERO_SIDES);
      expect(row.columns[0].blocks[0].styles.margin).toEqual(ZERO_SIDES);
    });

    it('gives each block its own margin object, not a shared one', () => {
      // A shared ZERO_SIDES reference would make editing one block's margin
      // silently move every other block.
      const design = normalizeDesign(legacyDesign());
      const margin = design.sections[0].rows[0].columns[0].blocks[0].styles.margin;
      expect(margin).not.toBe(ZERO_SIDES);
    });

    it('defaults the visibility flags to visible', () => {
      const block = normalizeDesign(legacyDesign()).sections[0].rows[0].columns[0].blocks[0];
      expect(block.hidden).toBeFalse();
      expect(block.hideOnMobile).toBeFalse();
      expect(block.hideOnDesktop).toBeFalse();
    });

    it('leaves values that are already set alone', () => {
      const design = legacyDesign();
      design.preheader = 'Existing preheader';
      design.sections[0].rows[0].columns[0].blocks[0].hideOnMobile = true;
      const normalized = normalizeDesign(design);
      expect(normalized.preheader).toBe('Existing preheader');
      expect(normalized.sections[0].rows[0].columns[0].blocks[0].hideOnMobile).toBeTrue();
    });

    it('survives a design with no sections at all', () => {
      const empty = { version: 1, contentWidth: 600, globalStyles: { desktop: {}, mobile: {} } } as unknown as EmailDesign;
      expect(() => normalizeDesign(empty)).not.toThrow();
    });
  });

  describe('createDesignFromLegacyHtml', () => {
    it('puts the whole document into one left-aligned text block in the body', () => {
      const design = createDesignFromLegacyHtml('<p>Hello {{Customer Name}}</p>');
      const block = design.sections[1].rows[0].columns[0].blocks[0];
      expect(block.type).toBe('text');
      expect(block.styles.align).toBe('left');
      expect((block as { props: { html: string } }).props.html).toBe('<p>Hello {{Customer Name}}</p>');
    });

    it('leaves header and footer empty', () => {
      const design = createDesignFromLegacyHtml('<p>x</p>');
      expect(design.sections[0].rows.length).toBe(0);
      expect(design.sections[2].rows.length).toBe(0);
    });

    it('tolerates empty input', () => {
      const block = createDesignFromLegacyHtml('').sections[1].rows[0].columns[0].blocks[0];
      expect((block as { props: { html: string } }).props.html).toBe('');
    });
  });

  describe('createDesignFromFullHtml', () => {
    const FULL = [
      '<html><head><style>.a{color:red}</style></head>',
      '<body><h1>Title</h1><script>alert(1)</script><p>Body</p></body></html>',
    ].join('');

    it('extracts the body content rather than nesting a second document', () => {
      const html = htmlOf(createDesignFromFullHtml(FULL));
      expect(html).toContain('<h1>Title</h1>');
      expect(html).toContain('<p>Body</p>');
      expect(html).not.toContain('<body');
      expect(html).not.toContain('<html');
    });

    it('keeps head styles, which the body content depends on', () => {
      expect(htmlOf(createDesignFromFullHtml(FULL))).toContain('.a{color:red}');
    });

    it('strips scripts', () => {
      const html = htmlOf(createDesignFromFullHtml(FULL));
      expect(html).not.toContain('alert(1)');
      expect(html).not.toContain('<script');
    });

    it('falls back to the whole source when there is no body tag', () => {
      expect(htmlOf(createDesignFromFullHtml('<p>fragment</p>'))).toContain('<p>fragment</p>');
    });

    it('lands as an html block, not a text block', () => {
      // A text block would have its markup escaped by the compiler.
      expect(createDesignFromFullHtml(FULL).sections[1].rows[0].columns[0].blocks[0].type)
        .toBe('html');
    });

    function htmlOf(design: EmailDesign): string {
      const block = design.sections[1].rows[0].columns[0].blocks[0];
      return (block as unknown as { props: { html: string } }).props.html;
    }
  });

  describe('resolveMobileStyles', () => {
    const desktop = { align: 'center', backgroundColor: '#fff' } as unknown as BlockStyles;

    it('returns the desktop styles untouched while styles are linked', () => {
      const resolved = resolveMobileStyles({
        styles: desktop, mobileStyles: { align: 'left' } as Partial<BlockStyles>, stylesLinked: true,
      });
      expect(resolved).toBe(desktop);
    });

    it('layers mobile overrides on top once unlinked', () => {
      const resolved = resolveMobileStyles({
        styles: desktop, mobileStyles: { align: 'left' } as Partial<BlockStyles>, stylesLinked: false,
      });
      expect(resolved.align).toBe('left');
      expect(resolved.backgroundColor).toBe('#fff');
    });

    it('does not mutate the desktop styles when unlinked', () => {
      resolveMobileStyles({
        styles: desktop, mobileStyles: { align: 'left' } as Partial<BlockStyles>, stylesLinked: false,
      });
      expect(desktop.align).toBe('center');
    });
  });

  describe('resolveMobileGlobalStyles', () => {
    it('layers the mobile global styles over the desktop ones', () => {
      const design = createDefaultDesign();
      design.globalStyles.mobile = { bodyBackgroundColor: '#000000' };
      const resolved = resolveMobileGlobalStyles(design);
      expect(resolved.bodyBackgroundColor).toBe('#000000');
    });

    it('keeps desktop keys the mobile set does not override', () => {
      const design = createDefaultDesign();
      const desktopHeading = design.globalStyles.desktop.heading.fontFamily;
      design.globalStyles.mobile = { bodyBackgroundColor: '#000000' };
      expect(resolveMobileGlobalStyles(design).heading.fontFamily).toBe(desktopHeading);
    });

    it('returns the desktop set unchanged when nothing is overridden', () => {
      const design = createDefaultDesign();
      expect(resolveMobileGlobalStyles(design)).toEqual(design.globalStyles.desktop);
    });
  });
});
