import { PageContentModel } from '@impact-common/shared/models/domain/page-content.model';
import { KitPagesComponent } from './kit-pages.component';

// Hand-constructed with duck-typed deps - no DI here, just behaviour.

const page = (over: Partial<PageContentModel> = {}) =>
  ({ id: 'mens-retreat', title: "Men's Retreat", blocks: [], ...over }) as PageContentModel;

function build(over: Record<string, unknown> = {}) {
  const saved: { id: string; fields: Record<string, unknown> }[] = [];
  const messages: string[] = [];

  const service = {
    getAll: () => Promise.resolve([]),
    update: () => Promise.resolve(),
    updateFields: (id: string, fields: Record<string, unknown>) => {
      saved.push({ id, fields });
      return Promise.resolve();
    },
    delete: () => Promise.resolve(),
    ...over
  };

  const component = new KitPagesComponent(
    service as never,
    { open: () => ({ afterClosed: () => ({ toPromise: () => Promise.resolve(undefined) }) }) } as never,
    { success: (m: string) => messages.push(m), error: (m: string) => messages.push(m) } as never,
    { confirm: () => Promise.resolve(true) } as never
  );

  return { component, saved, messages };
}

describe('the pages list', () => {
  it('hands the editor a REFERENTIALLY STABLE page', () => {
    // THE BUG THIS EXISTS FOR, and it froze the browser solid.
    //
    // This was a getter returning kitPage(selected), which builds a new object
    // every call. A template binding re-reads a getter on every change
    // detection pass, and PageStackComponent reloads its document in
    // ngOnChanges - which fires on every new reference. New object, reload,
    // async resolve, change detection, new object, forever. The tab stopped
    // responding and the browser offered to kill the page.
    //
    // Reading it twice must give the SAME object.
    const { component } = build();
    component.open(page());

    const first = component.selectedPage;
    const second = component.selectedPage;

    expect(first).withContext('nothing was selected').not.toBeNull();
    expect(second).withContext('a new object per read - this is the freeze').toBe(first);
  });

  it('builds a fresh page object when a DIFFERENT page is opened', () => {
    // The other half: stable is not the same as frozen. Opening another page
    // must rebind, or the editor would keep showing the first one's sections
    // under the second one's name.
    const { component } = build();

    component.open(page({ id: 'a', title: 'A' }));
    const first = component.selectedPage;
    component.open(page({ id: 'b', title: 'B' }));

    expect(component.selectedPage).not.toBe(first);
    expect(component.selectedPage?.slug).toBe('b');
  });

  it('clears the editor page on the way back to the list', () => {
    const { component } = build();
    component.open(page());
    component.closeEditor();

    expect(component.selectedPage).toBeNull();
    expect(component.selected).toBeNull();
  });
});

describe('publishing a page', () => {
  it('refuses to publish one with no sections', async () => {
    // A page with nothing on it renders as a bare header and footer. Better
    // to say so than to let somebody publish it and wonder what happened.
    const { component, saved, messages } = build();
    const target = page({ blocks: [] });

    await component.togglePublished(target, true);

    expect(saved.length).withContext('an empty page was published').toBe(0);
    expect(messages.join(' ')).toContain('empty');
  });

  it('publishes one that has a section', async () => {
    const { component, saved } = build();
    const target = page({ blocks: [{ key: 'k', isActive: true }] as never });

    await component.togglePublished(target, true);

    expect(saved.length).toBe(1);
    expect(saved[0].fields['isPublished']).toBeTrue();
  });

  it('always un-publishes, however empty the page is', async () => {
    // The guard is on going LIVE. Taking something off the site must never be
    // refused - that is the action somebody reaches for in a hurry.
    const { component, saved } = build();

    await component.togglePublished(page({ blocks: [] }), false);

    expect(saved.length).toBe(1);
    expect(saved[0].fields['isPublished']).toBeFalse();
  });
});

describe('saving a setting', () => {
  it('writes ONLY the field it changed', async () => {
    // Both this screen and the section editor write to the same document and
    // neither owns all of it. A whole-document write here would drop whatever
    // the editor had just saved - and `title` with it, which un-marks the
    // page and 404s it.
    const { component, saved } = build();

    await component.setSurface(page(), 'dark');

    expect(saved.length).toBe(1);
    expect(Object.keys(saved[0].fields)).toEqual(['theme']);
  });

  it('puts the old value back when the write fails', async () => {
    // Optimistic update, honestly reversed. A toggle that stays flipped after
    // a failed save is a lie about what is on the site.
    const { component, messages } = build({
      updateFields: () => Promise.reject(new Error('nope'))
    });
    const target = page({ isPublished: false, blocks: [{ key: 'k' }] as never });

    await component.togglePublished(target, true);

    expect(target.isPublished).withContext('left showing a state that never saved').toBeFalse();
    expect(messages.join(' ')).toContain('Could not save');
  });
});
