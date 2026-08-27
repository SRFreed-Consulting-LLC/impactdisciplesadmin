import { compileEmailDesign } from './email-design-compiler';
import { STARTER_TEMPLATES } from './starter-templates';
import { ARCHIVE_SHELLS } from './archive-shells';

// Every starter has to survive the round trip the gallery puts it through:
// build() -> compileEmailDesign() for the card preview, then build() again
// for the copy the editor loads. A starter whose design is malformed does
// not fail loudly - it throws inside the compile and the card silently
// renders blank, which is exactly how the first draft of the campaign
// editor's spec suite went wrong.
describe('STARTER_TEMPLATES', () => {
  it('has unique ids', () => {
    const ids = STARTER_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names and describes every starter', () => {
    for (const starter of STARTER_TEMPLATES) {
      expect(starter.name.length).toBeGreaterThan(0);
      expect(starter.description.length).toBeGreaterThan(0);
    }
  });

  it('covers the recurring series staff actually send', () => {
    const ids = STARTER_TEMPLATES.map((t) => t.id);
    expect(ids).toContain('prayer-letter');
    expect(ids).toContain('disciple-making-minute');
    expect(ids).toContain('blog-post');
    expect(ids).toContain('monthly-newsletter');
    expect(ids).toContain('podcast-episode');
  });

  for (const starter of STARTER_TEMPLATES) {
    describe(starter.name, () => {
      it('builds a design that compiles to non-empty html', () => {
        const html = compileEmailDesign(starter.build());
        expect(typeof html).toBe('string');
        expect(html.length).toBeGreaterThan(0);
      });

      it('is a FACTORY - two uses share no block identity', () => {
        const a = starter.build();
        const b = starter.build();
        const ids = (design: ReturnType<typeof starter.build>) =>
          design.sections.flatMap((s) =>
            s.rows.flatMap((r) => r.columns.flatMap((c) => c.blocks.map((bl) => bl.id))));
        const overlap = ids(a).filter((id) => ids(b).includes(id));
        expect(overlap).toEqual([]);
      });

      it('keeps the standard three sections', () => {
        expect(starter.build().sections.length).toBe(3);
      });
    });
  }

  // The DMM is text-only in real life; a starter that quietly grew an image
  // block would push staff back toward a layout they do not use.
  it('keeps Disciple-Making Minute free of images and buttons', () => {
    const design = STARTER_TEMPLATES.find((t) => t.id === 'disciple-making-minute')!.build();
    const types = design.sections.flatMap((s) =>
      s.rows.flatMap((r) => r.columns.flatMap((c) => c.blocks.map((b) => b.type))));
    expect(types).not.toContain('image');
    expect(types).not.toContain('button');
  });

  it('gives Blog Post exactly one call to action', () => {
    const design = STARTER_TEMPLATES.find((t) => t.id === 'blog-post')!.build();
    const buttons = design.sections.flatMap((s) =>
      s.rows.flatMap((r) => r.columns.flatMap((c) => c.blocks.filter((b) => b.type === 'button'))));
    expect(buttons.length).toBe(1);
  });
});

// Shells mined from the real campaign archive (scripts/extract-email-chrome.js).
// These are branded chrome that actually shipped, so what matters is that they
// survive the round trip into a design and back out of the compiler intact -
// the reason to reuse them is that they are known to render in real inboxes.
describe('archive shells', () => {
  const shellStarters = STARTER_TEMPLATES.filter((s) => s.id.startsWith('archive-shell-'));

  it('are registered as starters', () => {
    expect(shellStarters.length).toBeGreaterThan(0);
    expect(shellStarters.length).toBe(ARCHIVE_SHELLS.length);
  });

  it('puts the header in the header section and the footer in the footer', () => {
    for (const starter of shellStarters) {
      const design = starter.build();
      const shell = ARCHIVE_SHELLS.find((s) => s.id === starter.id)!;
      const first = design.sections[0].rows[0].columns[0].blocks[0];
      const last = design.sections[2].rows[0].columns[0].blocks[0];
      expect(first.type).toBe('html');
      expect(last.type).toBe('html');
      expect(first.type === 'html' && first.props.html).toBe(shell.header);
      expect(last.type === 'html' && last.props.html).toBe(shell.footer);
    }
  });

  it('leaves a writable body rather than an empty middle section', () => {
    // An entirely empty body gives nothing to click into and the canvas
    // reads as broken.
    for (const starter of shellStarters) {
      const body = starter.build().sections[1].rows[0].columns[0].blocks[0];
      expect(body.type).toBe('text');
    }
  });

  it('gives every use its own block ids', () => {
    // Starters are factories precisely so two emails from the same starter
    // cannot share ids and collide.
    const a = shellStarters[0].build();
    const b = shellStarters[0].build();
    expect(a.sections[0].rows[0].columns[0].blocks[0].id)
      .not.toBe(b.sections[0].rows[0].columns[0].blocks[0].id);
  });

  it('survives compilation with its markup intact', () => {
    for (const starter of shellStarters) {
      const html = compileEmailDesign(starter.build(), { title: starter.name });
      const shell = ARCHIVE_SHELLS.find((s) => s.id === starter.id)!;
      // A distinctive slice of the original, rather than the whole fragment:
      // the compiler wraps blocks, it does not rewrite their contents.
      expect(html).toContain(shell.footer.slice(0, 60));
    }
  });
});
