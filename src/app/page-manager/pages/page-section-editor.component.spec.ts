import { TestBed } from '@angular/core/testing';
import { PageContentBlock } from '@impact-common/shared/models/domain/page-content.model';
import { SECTION_ARCHETYPE } from '@impact-common/shared/lists/section_kit';
import { TestimonialService } from 'src/app/common/services/data/testimonial.service';
import { FormDefinitionService } from 'src/app/common/services/data/form-definition.service';
import { PageSectionEditorComponent, freshKey } from './page-section-editor.component';
import { kitPage } from './kit-page.adapter';

/**
 * THE COLUMN EDITOR - the half of the Section archetype that lives in the
 * admin.
 *
 * TestBed as an INJECTOR: this component takes its two services through
 * inject(), so `new`-ing it throws NG0203. Nothing here renders a template.
 */
describe('editing a section built from columns', () => {
  function build(section: Partial<PageContentBlock> = {}): PageSectionEditorComponent {
    TestBed.configureTestingModule({
      providers: [
        PageSectionEditorComponent,
        { provide: TestimonialService, useValue: { getAllByValue: () => Promise.resolve([]) } },
        { provide: FormDefinitionService, useValue: { getAll: () => Promise.resolve([]) } }
      ]
    });
    const component = TestBed.inject(PageSectionEditorComponent);
    component.section = {
      key: 'k1', type: SECTION_ARCHETYPE.SECTION, variant: 'columns', columns: [], ...section
    } as PageContentBlock;
    component.kind = kitPage({ id: 'seminars', title: 'Seminars', blocks: [] } as never)
      .kinds.find((k) => k.type === SECTION_ARCHETYPE.SECTION)!;
    return component;
  }

  it('shows the column editor only for a Section', () => {
    // ONE build per spec: TestBed cannot be reconfigured once it has handed
    // out an instance, so the second case swaps the kind on the same
    // component rather than asking for another.
    const component = build();
    expect(component.isColumnSection).toBe(true);

    component.kind = { ...component.kind, type: SECTION_ARCHETYPE.HERO_BAND };
    expect(component.isColumnSection).toBe(false);
  });

  it('adds empty columns up to the count asked for', () => {
    const component = build();
    component.setColumnCount(3);

    expect(component.columns.length).toBe(3);
    expect(component.columns.every((c) => c.pieces?.length === 0)).toBe(true);
  });

  it('gives every column and piece a key nothing else in the section uses', () => {
    // The lists are tracked BY KEY. Two rows sharing one behave as a single
    // row: dragging one moves the other, deleting one deletes both.
    const component = build();
    component.setColumnCount(3);
    for (const column of component.columns) {
      component.addPiece(column, 'heading');
      component.addPiece(column, 'heading');
    }

    const keys = component.columns.flatMap((c) => [c.key, ...(c.pieces ?? []).map((p) => p.key)]);
    expect(new Set(keys).size)
      .withContext('two things in this section were given the same key')
      .toBe(keys.length);
  });

  it('drops an empty column when the count goes down', () => {
    const component = build();
    component.setColumnCount(3);
    component.setColumnCount(1);

    expect(component.columns.length).toBe(1);
    expect(component.columnWarning).toBe('');
  });

  it('REFUSES to drop a column that still has something in it, and says why', () => {
    // Dropping it silently would take the pieces with it, and the pieces are
    // the work. Staff empty it first, which is a deliberate act.
    const component = build();
    component.setColumnCount(2);
    component.addPiece(component.columns[1], 'text');

    component.setColumnCount(1);

    expect(component.columns.length)
      .withContext('a column with content was dropped without asking')
      .toBe(2);
    expect(component.columnWarning).toContain('Empty the last column');
  });

  it('starts a new heading at section level, never as the page title', () => {
    // There is one page title per page and it is not the thing being added
    // twelve times.
    const component = build();
    component.setColumnCount(1);
    component.addPiece(component.columns[0], 'heading');

    expect(component.columns[0].pieces?.[0].level).toBe('section');
  });

  it('removes the piece that was asked for, not the one beside it', () => {
    const component = build();
    component.setColumnCount(1);
    const column = component.columns[0];
    component.addPiece(column, 'heading');
    component.addPiece(column, 'text');
    component.addPiece(column, 'buttons');

    component.removePiece(column, column.pieces![1]);

    expect(column.pieces!.map((p) => p.kind)).toEqual(['heading', 'buttons']);
  });
});

/**
 * THE PICTURE PICKER'S TARGET.
 *
 * It used to be an entry's numeric INDEX with null meaning the section,
 * which could not name a piece at all - a piece is in a column, which is in
 * a list - and silently retargeted if the entries were reordered while the
 * picker was open.
 */
describe('which thing is picking a picture', () => {
  function build(): PageSectionEditorComponent {
    TestBed.configureTestingModule({
      providers: [
        PageSectionEditorComponent,
        { provide: TestimonialService, useValue: { getAllByValue: () => Promise.resolve([]) } },
        { provide: FormDefinitionService, useValue: { getAll: () => Promise.resolve([]) } }
      ]
    });
    const component = TestBed.inject(PageSectionEditorComponent);
    component.section = {
      key: 'k1', type: SECTION_ARCHETYPE.SECTION, variant: 'columns', columns: []
    } as PageContentBlock;
    component.kind = kitPage({ id: 'seminars', title: 'Seminars', blocks: [] } as never)
      .kinds.find((k) => k.type === SECTION_ARCHETYPE.SECTION)!;
    return component;
  }

  const picture = { url: 'https://example.test/p.jpg', name: 'p' } as never;

  it('puts the chosen picture on the section when nothing else asked', () => {
    const component = build();
    component.showImageUploader();
    component.card.image = picture;
    component.closeImageUploader();

    expect(component.section.image).toBe(picture);
  });

  it('puts it on the piece that asked, even after the list is reordered', () => {
    // The regression the index could not survive. Reordering while the
    // picker is open used to move the picture onto a different row.
    const component = build();
    component.setColumnCount(1);
    const column = component.columns[0];
    component.addPiece(column, 'picture');
    component.addPiece(column, 'picture');
    const [first, second] = column.pieces!;

    component.showImageUploader(second);
    column.pieces = [second, first];
    component.card.image = picture;
    component.closeImageUploader();

    expect(second.image).toBe(picture);
    expect(first.image)
      .withContext('the picture landed on the wrong piece after a reorder')
      .toBeUndefined();
  });
});

describe('freshKey', () => {
  it('uses the plain name when nothing has taken it', () => {
    expect(freshKey('heading', new Set())).toBe('heading');
  });

  it('counts up rather than colliding', () => {
    expect(freshKey('heading', new Set(['heading']))).toBe('heading-2');
    expect(freshKey('heading', new Set(['heading', 'heading-2']))).toBe('heading-3');
  });
});
