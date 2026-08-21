import { of } from 'rxjs';
import { LibrarySubtemplateModel } from 'src/app/common/models/domain/library/library-subtemplate.model';
import { SubtemplatesListComponent } from './subtemplates-list.component';

// CHARACTERIZATION tests, written 2026-08-21 BEFORE swapping this screen's
// hand-rolled mat-table for the shared <app-data-grid> (bucket A item #1).
// Same pattern as lesson-templates-list.component.spec.ts, which this
// screen is the twin of.
//
// House style: hand-constructed with duck-typed deps, no TestBed.

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    subtemplateService: {
      getAll: jasmine.createSpy('getAll').and.returnValue(Promise.resolve([])),
      createSubtemplate: jasmine.createSpy('createSubtemplate').and.returnValue(Promise.resolve('new-id')),
      deleteSubtemplate: jasmine.createSpy('deleteSubtemplate').and.returnValue(Promise.resolve()),
    },
    confirmService: { confirm: jasmine.createSpy('confirm').and.returnValue(Promise.resolve(true)) },
    dialog: { open: jasmine.createSpy('open') },
    router: { navigate: jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true)) },
    ...overrides,
  };
}

function makeComponent(overrides: Record<string, unknown> = {}) {
  const d = makeDeps(overrides);
  const component = new SubtemplatesListComponent(
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

const aSubtemplate = (extra: Partial<LibrarySubtemplateModel> = {}): LibrarySubtemplateModel =>
  ({ id: 's-1', title: 'Header A', type: 'header', ...extra }) as LibrarySubtemplateModel;

describe('SubtemplatesListComponent', () => {
  describe('loading', () => {
    it('loads the list and clears the spinner', async () => {
      const { component } = makeComponent({
        subtemplateService: { ...makeDeps().subtemplateService, getAll: () => Promise.resolve([aSubtemplate()]) },
      });
      expect(component.loading).toBeTrue();
      component.ngOnInit();
      await flush();
      expect(component.subtemplates.length).toBe(1);
      expect(component.loading).toBeFalse();
    });
  });

  describe('fieldCount', () => {
    it('counts the schema components', () => {
      const { component } = makeComponent();
      const s = aSubtemplate({ formSchema: { components: [{}, {}, {}] } } as Partial<LibrarySubtemplateModel>);
      expect(component.fieldCount(s)).toBe(3);
    });

    it('is 0 when the schema or its components are absent', () => {
      // A subtemplate can exist before anyone adds a field to it.
      const { component } = makeComponent();
      expect(component.fieldCount(aSubtemplate())).toBe(0);
      expect(component.fieldCount(aSubtemplate({ formSchema: {} } as Partial<LibrarySubtemplateModel>))).toBe(0);
    });
  });

  describe('typeLabel', () => {
    it('names each slot type', () => {
      const { component } = makeComponent();
      expect(component.typeLabel('header')).toBe('Header');
      expect(component.typeLabel('footer')).toBe('Footer');
      expect(component.typeLabel('layout')).toBe('Layout');
    });

    it('reads an absent type as an em dash rather than blank', () => {
      expect(makeComponent().component.typeLabel(undefined)).toBe('—');
    });
  });

  describe('open', () => {
    it('routes to the subtemplate editor', () => {
      const { component, deps } = makeComponent();
      component.openSubtemplate(aSubtemplate({ id: 's-9' }));
      expect(deps.router.navigate).toHaveBeenCalledWith(['/library-manager/subtemplates', 's-9']);
    });
  });

  describe('create', () => {
    it('creates with BOTH the name and the chosen type, then routes in', async () => {
      const { component, deps } = makeComponent({
        dialog: { open: () => ({ afterClosed: () => of({ name: 'Footer B', type: 'footer' }) }) },
      });
      await component.createSubtemplate();
      expect(deps.subtemplateService.createSubtemplate).toHaveBeenCalledWith('Footer B', 'footer');
      expect(deps.router.navigate).toHaveBeenCalledWith(['/library-manager/subtemplates', 'new-id']);
    });

    it('does nothing when the dialog is cancelled', async () => {
      const { component, deps } = makeComponent({
        dialog: { open: () => ({ afterClosed: () => of(undefined) }) },
      });
      await component.createSubtemplate();
      expect(deps.subtemplateService.createSubtemplate).not.toHaveBeenCalled();
      expect(deps.router.navigate).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('confirms, then deletes by id, title AND type, and reloads', async () => {
      // The type is passed too - deletion is per-type on this service.
      const { component, deps } = makeComponent();
      deps.subtemplateService.getAll.calls.reset();

      await component.deleteSubtemplate(aSubtemplate({ id: 's-3', title: 'Layout C', type: 'layout' }));
      await flush();

      expect(deps.confirmService.confirm).toHaveBeenCalled();
      expect(deps.subtemplateService.deleteSubtemplate).toHaveBeenCalledWith('s-3', 'Layout C', 'layout');
      expect(deps.subtemplateService.getAll).toHaveBeenCalled();
    });

    it('does nothing when the confirm is declined', async () => {
      const { component, deps } = makeComponent();
      deps.confirmService.confirm.and.returnValue(Promise.resolve(false));
      await component.deleteSubtemplate(aSubtemplate());
      expect(deps.subtemplateService.deleteSubtemplate).not.toHaveBeenCalled();
    });
  });
});
