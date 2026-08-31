import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { PageContentModel } from '@impact-common/shared/models/domain/page-content.model';
import { PageContentService } from 'src/app/common/services/data/page-content.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { KitPageEditorComponent } from './kit-page-editor.component';

// The behaviours the Pages LIST screen used to pin, ported here when that
// screen was removed (2026-08-30: the left nav IS the list) and every
// per-page control moved into this header. TestBed as an INJECTOR only - the
// class uses inject(), so a bare `new` throws NG0203.

function build(over: Record<string, unknown> = {}) {
  const saved: { id: string; fields: Record<string, unknown> }[] = [];
  const deleted: string[] = [];
  const navigated: unknown[] = [];
  const messages: string[] = [];
  let confirmAnswer = true;

  const doc = (): PageContentModel =>
    ({ id: 'mens-retreat', title: "Men's Retreat", blocks: [{ key: 'k' }], isPublished: false }) as PageContentModel;

  TestBed.configureTestingModule({
    providers: [
      {
        provide: PageContentService,
        useValue: {
          getById: () => Promise.resolve(doc()),
          updateFields: (id: string, fields: Record<string, unknown>) => {
            saved.push({ id, fields });
            return Promise.resolve();
          },
          delete: (id: string) => {
            deleted.push(id);
            return Promise.resolve();
          },
          ...over
        }
      },
      { provide: SnackbarService, useValue: { success: (m: string) => messages.push(m), error: (m: string) => messages.push(m) } },
      { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(confirmAnswer) } },
      { provide: Router, useValue: { navigate: (c: unknown, e: unknown) => { navigated.push([c, e]); return Promise.resolve(true); } } }
    ]
  });

  const component = TestBed.runInInjectionContext(() => new KitPageEditorComponent());
  component.slug = 'mens-retreat';

  return {
    component, saved, deleted, navigated, messages,
    setConfirm: (answer: boolean) => { confirmAnswer = answer; }
  };
}

describe('the per-leaf page editor', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('hands the stack a REFERENTIALLY STABLE page', async () => {
    // The getter version of this froze the browser once (a new object per
    // change-detection read re-fires the stack's ngOnChanges forever). It is
    // a field built once per load; two reads must be the SAME object.
    const { component } = build();
    component.ngOnChanges();
    await Promise.resolve();
    await Promise.resolve();

    const first = component.editablePage;
    expect(first).withContext('the load never produced a page').not.toBeNull();
    expect(component.editablePage).toBe(first);
  });

  it('refuses a document with no title - one of the twelve, or nothing', async () => {
    const { component } = build({ getById: () => Promise.resolve({ id: 'about-us', blocks: [] }) });
    component.ngOnChanges();
    await Promise.resolve();
    await Promise.resolve();

    expect(component.editablePage).toBeNull();
    expect(component.failed).toBeTrue();
  });

  it('refuses to publish a page with no sections', async () => {
    const { component, saved, messages } = build();
    component.page = { id: 'x', title: 'X', blocks: [] } as never;

    await component.togglePublished(true);

    expect(saved.length).withContext('an empty page was published').toBe(0);
    expect(messages.join(' ')).toContain('empty');
  });

  it('always un-publishes, however empty the page is', async () => {
    // The guard is on going LIVE. Taking something off the site must never
    // be refused - that is the action somebody reaches for in a hurry.
    const { component, saved } = build();
    component.page = { id: 'x', title: 'X', blocks: [] } as never;

    await component.togglePublished(false);

    expect(saved.length).toBe(1);
    expect(saved[0].fields['isPublished']).toBeFalse();
  });

  it('writes ONLY the field it changed', async () => {
    // The section editor owns `blocks`; this header must never overwrite
    // them. A whole-document write here is the setDoc-no-merge bug again.
    const { component, saved } = build();
    component.page = { id: 'x', title: 'X', blocks: [{ key: 'k' }] } as never;

    await component.setSurface('dark');
    await component.togglePublished(true);

    expect(saved.map((s) => Object.keys(s.fields))).toEqual([['theme'], ['isPublished']]);
  });

  it('puts the old value back when a write fails', async () => {
    const { component, messages } = build({
      updateFields: () => Promise.reject(new Error('nope'))
    });
    component.page = { id: 'x', title: 'X', blocks: [{ key: 'k' }], isPublished: false } as never;

    await component.togglePublished(true);

    expect(component.page?.isPublished)
      .withContext('left showing a state that never saved').toBeFalse();
    expect(messages.join(' ')).toContain('Could not save');
  });

  it('deletes only past the confirm, then leaves the dead page', async () => {
    const { component, deleted, navigated, setConfirm } = build();
    component.page = { id: 'mens-retreat', title: "Men's Retreat", blocks: [] } as never;

    setConfirm(false);
    await component.remove();
    expect(deleted.length).withContext('deleted despite a declined confirm').toBe(0);

    setConfirm(true);
    await component.remove();
    expect(deleted).toEqual(['mens-retreat']);
    expect(navigated.length).withContext('stayed on an editor for a deleted page').toBe(1);
  });
});

/**
 * THE COMPARISON, per page.
 *
 * The approval tool for the second migration: this page drawn from the
 * fourteen archetypes on the left, and the same document flipped through
 * toSectionBlocks() on the right, from the transform the cutover will run.
 */
describe('comparing a page with what it would become', () => {
  it('starts on the editor, never on the comparison', () => {
    const { component } = build();
    expect(component.comparing).toBe(false);
  });

  it('goes back to the editor when a different page is opened', () => {
    // Arriving at Seminars mid-comparison of About Us is baffling, and it is
    // the thing a boolean on a reused component instance gets wrong: the
    // leaf clicks are same-route navigations, so this instance survives them.
    const { component } = build();
    component.comparing = true;

    component.slug = 'another-page';
    component.ngOnChanges();

    expect(component.comparing).toBe(false);
  });

  it('frames the page at its real public address', () => {
    const { component } = build();
    component.slug = 'mens-retreat';

    expect(component.publicPath).toBe('/mens-retreat');
  });

  it('frames HOME at the site root, not at /home', () => {
    // The dynamic route deliberately refuses 'home' so it cannot become a
    // second copy of the front page. Comparing it at /home would frame Not
    // Found beside the preview and read as the migration losing the page.
    const { component } = build();
    component.slug = 'home';

    expect(component.publicPath).toBe('/');
  });
});
