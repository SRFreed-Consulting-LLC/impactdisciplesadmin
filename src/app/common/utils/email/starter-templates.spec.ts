import { compileEmailDesign } from './email-design-compiler';
import { STARTER_TEMPLATES } from './starter-templates';

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
