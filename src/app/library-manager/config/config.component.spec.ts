import { of } from 'rxjs';
import { BulkDiscountTier } from '@impact-common/models/bulk-discount-tier.model';
import { LibraryConfigComponent } from './config.component';

// CHARACTERIZATION tests, written 2026-08-21 BEFORE swapping this screen's
// hand-rolled mat-table for the shared <app-data-grid> (bucket A item #1).
//
// The behaviour worth pinning is the error handling: every one of the three
// write paths logs to LibraryErrorLogService AND surfaces a snackbar, and
// create is the only one that shows the underlying error message to the
// admin (the other two show a fixed sentence). Getting that wrong either
// swallows a failure silently or leaks a raw Firestore error into the UI.
//
// House style: hand-constructed with duck-typed deps, no TestBed - this
// component uses constructor injection.

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    tierService: {
      getTiers: jasmine.createSpy('getTiers').and.returnValue(Promise.resolve([])),
      createTier: jasmine.createSpy('createTier').and.returnValue(Promise.resolve()),
      updateTier: jasmine.createSpy('updateTier').and.returnValue(Promise.resolve()),
      deleteTier: jasmine.createSpy('deleteTier').and.returnValue(Promise.resolve()),
    },
    confirmService: { confirm: jasmine.createSpy('confirm').and.returnValue(Promise.resolve(true)) },
    snackbar: { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') },
    dialog: { open: jasmine.createSpy('open').and.returnValue({ afterClosed: () => of(undefined) }) },
    errorLog: { logError: jasmine.createSpy('logError') },
    ...overrides,
  };
}

function makeComponent(overrides: Record<string, unknown> = {}) {
  const d = makeDeps(overrides);
  const component = new LibraryConfigComponent(
    d.tierService as never,
    d.confirmService as never,
    d.snackbar as never,
    d.dialog as never,
    d.errorLog as never,
  );
  return { component, deps: d };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}

const aTier = (numberOfBooks = 5, percentOff = 10): BulkDiscountTier =>
  ({ numberOfBooks, percentOff }) as BulkDiscountTier;

/** A dialog stub that closes with `result`. */

const dialogReturning = (result: unknown) => ({ open: () => ({ afterClosed: () => of(result) }) });

describe('LibraryConfigComponent', () => {
  describe('loading', () => {
    it('loads tiers and clears the spinner', async () => {
      const { component } = makeComponent({
        tierService: { ...makeDeps().tierService, getTiers: () => Promise.resolve([aTier()]) },
      });
      expect(component.loading).toBeTrue();
      component.ngOnInit();
      await flush();
      expect(component.tiers.length).toBe(1);
      expect(component.loading).toBeFalse();
    });
  });

  describe('create', () => {
    it('creates, reports success and reloads', async () => {
      const { component, deps } = makeComponent({ dialog: dialogReturning({ numberOfBooks: 10, percentOff: 20 }) });
      deps.tierService.getTiers.calls.reset();
      await component.openCreateDialog();
      await flush();

      expect(deps.tierService.createTier).toHaveBeenCalledWith(10, 20);
      expect(deps.snackbar.success).toHaveBeenCalledWith('Discount tier created.');
      expect(deps.tierService.getTiers).toHaveBeenCalled();
    });

    it('does nothing when the dialog is cancelled', async () => {
      const { component, deps } = makeComponent({ dialog: dialogReturning(undefined) });
      await component.openCreateDialog();
      expect(deps.tierService.createTier).not.toHaveBeenCalled();
    });

    it('surfaces the UNDERLYING error message, and logs it', async () => {
      // Create is the one path that shows the real message - a duplicate
      // tier is a normal mistake and the admin needs to know which.
      const { component, deps } = makeComponent({ dialog: dialogReturning({ numberOfBooks: 5, percentOff: 10 }) });
      deps.tierService.createTier.and.returnValue(Promise.reject(new Error('Tier 5 already exists')));
      await component.openCreateDialog();
      await flush();

      expect(deps.snackbar.error).toHaveBeenCalledWith('Tier 5 already exists');
      expect(deps.errorLog.logError).toHaveBeenCalled();
    });

    it('falls back to a readable sentence for a non-Error throw', async () => {
      const { component, deps } = makeComponent({ dialog: dialogReturning({ numberOfBooks: 5, percentOff: 10 }) });
      deps.tierService.createTier.and.returnValue(Promise.reject('just a string'));
      await component.openCreateDialog();
      await flush();

      expect(deps.snackbar.error).toHaveBeenCalledWith(
        'Something went wrong creating the tier. Please try again.',
      );
    });
  });

  describe('edit', () => {
    it('updates, reports success and reloads', async () => {
      const { component, deps } = makeComponent({ dialog: dialogReturning({ numberOfBooks: 5, percentOff: 15 }) });
      await component.openEditDialog(aTier(5, 10));
      await flush();

      expect(deps.tierService.updateTier).toHaveBeenCalledWith(5, 15);
      expect(deps.snackbar.success).toHaveBeenCalledWith('Discount tier updated.');
    });

    it('shows a FIXED sentence on failure, never the raw error', async () => {
      const { component, deps } = makeComponent({ dialog: dialogReturning({ numberOfBooks: 5, percentOff: 15 }) });
      deps.tierService.updateTier.and.returnValue(Promise.reject(new Error('PERMISSION_DENIED: raw')));
      await component.openEditDialog(aTier());
      await flush();

      expect(deps.snackbar.error).toHaveBeenCalledWith('Something went wrong saving changes. Please try again.');
      expect(deps.errorLog.logError).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('confirms, deletes BY numberOfBooks, reports and reloads', async () => {
      // A tier has no id field - its doc id IS String(numberOfBooks).
      const { component, deps } = makeComponent();
      await component.deleteTier(aTier(10, 20));
      await flush();

      expect(deps.confirmService.confirm).toHaveBeenCalled();
      expect(deps.tierService.deleteTier).toHaveBeenCalledWith(10);
      expect(deps.snackbar.success).toHaveBeenCalledWith('Discount tier deleted.');
    });

    it('does nothing when the confirm is declined', async () => {
      const { component, deps } = makeComponent();
      deps.confirmService.confirm.and.returnValue(Promise.resolve(false));
      await component.deleteTier(aTier());
      expect(deps.tierService.deleteTier).not.toHaveBeenCalled();
    });

    it('shows a fixed sentence and logs on failure', async () => {
      const { component, deps } = makeComponent();
      deps.tierService.deleteTier.and.returnValue(Promise.reject(new Error('boom')));
      await component.deleteTier(aTier());
      await flush();

      expect(deps.snackbar.error).toHaveBeenCalledWith('Something went wrong deleting the tier. Please try again.');
      expect(deps.errorLog.logError).toHaveBeenCalled();
    });
  });
});
