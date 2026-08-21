import { Observable, of } from 'rxjs';
import { BaseModel } from '@impact-common/shared/models/base.model';
import { DataGridColumn } from './data-grid/data-grid.model';
import { BaseListComponent } from './base-list.component';

// CHARACTERIZATION tests for the shared CRUD list-screen skeleton, written
// 2026-08-21 BEFORE extending it (refactor sweep, bucket A item #6). Five
// screens already inherit from it - Coupons, Sales, Testimonials, DMMs, Home
// Page Images - and it had no test of any kind, so every one of them was
// relying on untested shared behaviour.
//
// The gates are the point. Each of showAddModal/showEditModal/delete checks
// its own permission and FAILS SILENTLY when denied, and the header/row
// actions are built from the same checks - so a change here changes who can
// do what on five screens at once.
//
// House style: hand-constructed, duck-typed deps, no TestBed. The class is
// abstract, so the tests drive it through a minimal concrete subclass -
// which is also the closest thing to documenting what a subclass owes it.

interface Thing extends BaseModel { name?: string }

class TestListComponent extends BaseListComponent<Thing> {
  readonly itemType = 'Thing';
  protected readonly screenKey = 'test.things';
  readonly columns: DataGridColumn<Thing>[] = [{ key: 'name', label: 'Name' }];
  protected readonly dialogComponent = class {} as never;
}

/** A subclass that needs an ordered query instead of the plain stream. */
class CustomLoadComponent extends TestListComponent {
  loadCalls = 0;
  protected override loadItems(): Observable<Thing[]> {
    this.loadCalls++;
    return of([{ id: 'custom' } as Thing]);
  }
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const permissions: Record<string, boolean> = {};
  return {
    service: {
      streamAll: jasmine.createSpy('streamAll').and.returnValue(of([{ id: 'a' }, { id: 'b' }] as Thing[])),
      delete: jasmine.createSpy('delete').and.returnValue(Promise.resolve()),
    },
    permissionService: {
      // Default-allow; individual tests deny a specific verb.
      canAdd: (key: string) => permissions['add:' + key] !== false,
      canEdit: (key: string) => permissions['edit:' + key] !== false,
      canDelete: (key: string) => permissions['delete:' + key] !== false,
    },
    dialog: { open: jasmine.createSpy('open') },
    confirmService: { confirm: jasmine.createSpy('confirm').and.returnValue(Promise.resolve(true)) },
    snackbar: { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') },
    permissions,
    ...overrides,
  };
}

function makeComponent(Ctor: typeof TestListComponent = TestListComponent) {
  const d = makeDeps();
  const component = new Ctor(
    d.service as never,
    d.permissionService as never,
    d.dialog as never,
    d.confirmService as never,
    d.snackbar as never,
  );
  return { component, deps: d };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}

describe('BaseListComponent', () => {
  describe('loading', () => {
    it('streams the whole collection by default', (done) => {
      const { component, deps } = makeComponent();
      component.ngOnInit();
      component.items$.subscribe((rows) => {
        expect(deps.service.streamAll).toHaveBeenCalled();
        expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
        done();
      });
    });

    it('shows the spinner until the FIRST emission, then hides it', (done) => {
      const { component } = makeComponent();
      // House rule: true before anything arrives.
      expect(component.loading$.value).toBeTrue();
      component.ngOnInit();
      component.items$.subscribe(() => {
        expect(component.loading$.value).toBeFalse();
        done();
      });
    });

    it('lets a subclass override the query', (done) => {
      const { component } = makeComponent(CustomLoadComponent);
      component.ngOnInit();
      component.items$.subscribe((rows) => {
        expect((component as CustomLoadComponent).loadCalls).toBe(1);
        expect(rows.map((r) => r.id)).toEqual(['custom']);
        done();
      });
    });
  });

  describe('header action', () => {
    it('offers New when the user may add', () => {
      const { component } = makeComponent();
      component.ngOnInit();
      expect(component.headerActions.length).toBe(1);
      expect(component.headerActions[0].label).toBe('New');
    });

    it('offers NOTHING when the user may not add', () => {
      const { component, deps } = makeComponent();
      deps.permissions['add:test.things'] = false;
      component.ngOnInit();
      expect(component.headerActions).toEqual([]);
    });

    it('wires New to the add dialog', () => {
      const { component, deps } = makeComponent();
      component.ngOnInit();
      component.headerActions[0].onClick();
      expect(deps.dialog.open).toHaveBeenCalled();
    });
  });

  describe('row actions', () => {
    it('shows delete only when the user may delete', () => {
      const { component, deps } = makeComponent();
      expect(component.rowActions[0].visible!({ id: 'a' })).toBeTrue();
      deps.permissions['delete:test.things'] = false;
      expect(component.rowActions[0].visible!({ id: 'a' })).toBeFalse();
    });
  });

  describe('dialogs', () => {
    it('opens add with a NULL item', () => {
      const { component, deps } = makeComponent();
      component.showAddModal();
      expect(deps.dialog.open.calls.mostRecent().args[1].data).toEqual({ item: null });
    });

    it('opens edit with the row', () => {
      const { component, deps } = makeComponent();
      const item = { id: 'a' } as Thing;
      component.showEditModal(item);
      expect(deps.dialog.open.calls.mostRecent().args[1].data).toEqual({ item });
    });

    it('uses the default width unless a subclass overrides it', () => {
      const { component, deps } = makeComponent();
      component.showAddModal();
      expect(deps.dialog.open.calls.mostRecent().args[1].width).toBe('600px');
    });

    it('add is permission-gated and fails SILENTLY', () => {
      const { component, deps } = makeComponent();
      deps.permissions['add:test.things'] = false;
      component.showAddModal();
      expect(deps.dialog.open).not.toHaveBeenCalled();
    });

    it('edit is permission-gated and fails SILENTLY', () => {
      const { component, deps } = makeComponent();
      deps.permissions['edit:test.things'] = false;
      component.showEditModal({ id: 'a' } as Thing);
      expect(deps.dialog.open).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('confirms, deletes, then reports using the subclass\'s itemType', async () => {
      const { component, deps } = makeComponent();
      component.delete({ id: 'a' } as Thing);
      await flush();
      expect(deps.confirmService.confirm).toHaveBeenCalled();
      expect(deps.service.delete).toHaveBeenCalledWith('a');
      expect(deps.snackbar.success).toHaveBeenCalledWith('Thing Deleted');
    });

    it('does nothing when the confirm is declined', async () => {
      const { component, deps } = makeComponent();
      deps.confirmService.confirm.and.returnValue(Promise.resolve(false));
      component.delete({ id: 'a' } as Thing);
      await flush();
      expect(deps.service.delete).not.toHaveBeenCalled();
      expect(deps.snackbar.success).not.toHaveBeenCalled();
    });

    it('is permission-gated and fails SILENTLY, without even confirming', async () => {
      const { component, deps } = makeComponent();
      deps.permissions['delete:test.things'] = false;
      component.delete({ id: 'a' } as Thing);
      await flush();
      expect(deps.confirmService.confirm).not.toHaveBeenCalled();
      expect(deps.service.delete).not.toHaveBeenCalled();
    });
  });

  // Added 2026-08-21 so the dialog-hosted sub-editors (Product Categories,
  // Product Series, Podcast Categories) can share this skeleton WITHOUT
  // changing who can do what on them - see screenKey's own comment.
  describe('ungated screens (screenKey === null)', () => {
    class UngatedComponent extends TestListComponent {
      protected override readonly screenKey = null;
    }

    it('allows add/edit/delete without consulting permissions at all', async () => {
      const { component, deps } = makeComponent(UngatedComponent);
      // Deny everything; an ungated screen must not care.
      deps.permissions['add:test.things'] = false;
      deps.permissions['edit:test.things'] = false;
      deps.permissions['delete:test.things'] = false;

      component.ngOnInit();
      expect(component.headerActions.length).toBe(1);

      component.showAddModal();
      component.showEditModal({ id: 'a' } as Thing);
      expect(deps.dialog.open).toHaveBeenCalledTimes(2);

      expect(component.rowActions[0].visible!({ id: 'a' })).toBeTrue();
      component.delete({ id: 'a' } as Thing);
      await flush();
      expect(deps.service.delete).toHaveBeenCalledWith('a');
    });

    it('never passes a null key to the permission service', () => {
      // Guards the non-null assertions in the can*Here() helpers.
      const { component, deps } = makeComponent(UngatedComponent);
      const canAdd = spyOn(deps.permissionService, 'canAdd').and.callThrough();
      component.ngOnInit();
      component.showAddModal();
      expect(canAdd).not.toHaveBeenCalled();
    });
  });

  describe('overridable delete gate', () => {
    class EditGatedDeleteComponent extends TestListComponent {
      // Mirrors Podcast Categories, whose delete has always ridden canEdit.
      protected override canDeleteHere(): boolean {
        return this.permissionService.canEdit(this.screenKey!);
      }
    }

    it('lets a subclass ride a different verb', async () => {
      const { component, deps } = makeComponent(EditGatedDeleteComponent);
      // No delete permission, but edit is held: the button must stay.
      deps.permissions['delete:test.things'] = false;
      expect(component.rowActions[0].visible!({ id: 'a' })).toBeTrue();
      component.delete({ id: 'a' } as Thing);
      await flush();
      expect(deps.service.delete).toHaveBeenCalled();
    });

    it('and is denied when THAT verb is denied', async () => {
      const { component, deps } = makeComponent(EditGatedDeleteComponent);
      deps.permissions['edit:test.things'] = false;
      expect(component.rowActions[0].visible!({ id: 'a' })).toBeFalse();
      component.delete({ id: 'a' } as Thing);
      await flush();
      expect(deps.service.delete).not.toHaveBeenCalled();
    });
  });
});
