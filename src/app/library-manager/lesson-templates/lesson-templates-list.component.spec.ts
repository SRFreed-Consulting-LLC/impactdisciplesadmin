import { of } from 'rxjs';
import { LibraryLessonTemplateModel } from 'src/app/common/models/domain/library/library-lesson-template.model';
import { LessonTemplatesListComponent } from './lesson-templates-list.component';

// CHARACTERIZATION tests, written 2026-08-21 BEFORE swapping this screen's
// hand-rolled mat-table for the shared <app-data-grid> (bucket A item #1,
// the Library Manager fold). This is the FIRST spec anywhere in
// library-manager/** - the module is 4,400 TS lines with no test of any
// kind - so it doubles as the pattern the rest of the fold follows.
//
// The logic worth pinning is slotLabel's three-way distinction: a slot that
// was never set reads as an em dash, while a slot pointing at a subtemplate
// that no longer exists reads as "(deleted)". Collapsing those two would
// quietly tell an author their template is fine when it references a
// subtemplate someone removed.
//
// House style: hand-constructed with duck-typed deps, no TestBed. Note this
// component is standalone and uses constructor injection already, so nothing
// forces one - and per the 2026-08-21 decision the module KEEPS its modern
// idiom (standalone/inject/signals); the fold is about shared INFRASTRUCTURE.

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    lessonTemplateService: {
      getAll: jasmine.createSpy('getAll').and.returnValue(Promise.resolve([])),
      createLessonTemplate: jasmine.createSpy('createLessonTemplate').and.returnValue(Promise.resolve('new-id')),
      deleteLessonTemplate: jasmine.createSpy('deleteLessonTemplate').and.returnValue(Promise.resolve()),
    },
    subtemplateService: {
      getAll: jasmine.createSpy('getAll').and.returnValue(Promise.resolve([])),
    },
    confirmService: { confirm: jasmine.createSpy('confirm').and.returnValue(Promise.resolve(true)) },
    dialog: { open: jasmine.createSpy('open') },
    router: { navigate: jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true)) },
    ...overrides,
  };
}

function makeComponent(overrides: Record<string, unknown> = {}) {
  const d = makeDeps(overrides);
  const component = new LessonTemplatesListComponent(
    d.lessonTemplateService as never,
    d.subtemplateService as never,
    d.confirmService as never,
    d.dialog as never,
    d.router as never,
  );
  return { component, deps: d };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}

const aTemplate = (extra: Partial<LibraryLessonTemplateModel> = {}): LibraryLessonTemplateModel =>
  ({ id: 't-1', title: 'Week One', ...extra }) as LibraryLessonTemplateModel;

describe('LessonTemplatesListComponent', () => {
  describe('loading', () => {
    it('loads templates and their subtemplate titles together', async () => {
      const { component, deps } = makeComponent({
        lessonTemplateService: {
          ...makeDeps().lessonTemplateService,
          getAll: () => Promise.resolve([aTemplate()]),
        },
      });
      component.ngOnInit();
      await flush();

      expect(component.lessonTemplates.length).toBe(1);
      expect(deps.subtemplateService.getAll).toHaveBeenCalled();
      expect(component.loading).toBeFalse();
    });

    it('starts in the loading state', () => {
      expect(makeComponent().component.loading).toBeTrue();
    });
  });

  // The three-way distinction that matters.
  describe('slotLabel', () => {
    async function withSubtemplates(subtemplates: { id: string; title: string }[]) {
      const { component } = makeComponent({
        subtemplateService: { getAll: () => Promise.resolve(subtemplates) },
      });
      component.ngOnInit();
      await flush();
      return component;
    }

    it('names a slot that points at a subtemplate that still exists', async () => {
      const component = await withSubtemplates([{ id: 's-1', title: 'Header A' }]);
      expect(component.slotLabel('s-1')).toBe('Header A');
    });

    it('reads an UNSET slot as an em dash', async () => {
      const component = await withSubtemplates([]);
      expect(component.slotLabel(null)).toBe('—');
    });

    it('reads a slot whose subtemplate was DELETED as "(deleted)", not as unset', async () => {
      // Collapsing this into the unset case would tell an author their
      // template is fine when it references something that is gone.
      const component = await withSubtemplates([{ id: 's-1', title: 'Header A' }]);
      expect(component.slotLabel('s-other')).toBe('(deleted)');
    });
  });

  describe('open', () => {
    it('routes to the template editor', () => {
      const { component, deps } = makeComponent();
      component.openLessonTemplate(aTemplate({ id: 't-9' }));
      expect(deps.router.navigate).toHaveBeenCalledWith(['/library-manager/lesson-templates', 't-9']);
    });
  });

  describe('create', () => {
    it('creates and routes straight into the new template', async () => {
      const { component, deps } = makeComponent({
        dialog: { open: () => ({ afterClosed: () => of('Week Two') }) },
      });
      await component.createLessonTemplate();

      expect(deps.lessonTemplateService.createLessonTemplate).toHaveBeenCalledWith('Week Two');
      expect(deps.router.navigate).toHaveBeenCalledWith(['/library-manager/lesson-templates', 'new-id']);
    });

    it('does nothing when the name dialog is cancelled', async () => {
      const { component, deps } = makeComponent({
        dialog: { open: () => ({ afterClosed: () => of(undefined) }) },
      });
      await component.createLessonTemplate();

      expect(deps.lessonTemplateService.createLessonTemplate).not.toHaveBeenCalled();
      expect(deps.router.navigate).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {

    it('confirms, deletes by id AND title, then reloads', async () => {
      const { component, deps } = makeComponent();
      deps.lessonTemplateService.getAll.calls.reset();

      await component.deleteLessonTemplate(aTemplate({ id: 't-3', title: 'Week Three' }));
      await flush();

      expect(deps.confirmService.confirm).toHaveBeenCalled();
      expect(deps.lessonTemplateService.deleteLessonTemplate).toHaveBeenCalledWith('t-3', 'Week Three');
      // Reloaded, so the row disappears without a manual refresh.
      expect(deps.lessonTemplateService.getAll).toHaveBeenCalled();
    });

    it('does nothing when the confirm is declined', async () => {
      const { component, deps } = makeComponent();
      deps.confirmService.confirm.and.returnValue(Promise.resolve(false));
      await component.deleteLessonTemplate(aTemplate());
      expect(deps.lessonTemplateService.deleteLessonTemplate).not.toHaveBeenCalled();
    });

    // The old single-click-to-open table needed the delete handler to call
    // stopPropagation/preventDefault. Rows now open on DOUBLE-click and the
    // grid owns the action button, so that guard is structurally unnecessary
    // and the test that pinned it went with it.
  });
});
