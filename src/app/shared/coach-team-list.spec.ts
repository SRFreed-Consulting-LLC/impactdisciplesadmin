import { BehaviorSubject, of } from 'rxjs';
import { CoachesComponent } from 'src/app/events-manager/coaches/coaches.component';
import { TeamPageComponent } from 'src/app/content-manager/team-page/team-page.component';

// CHARACTERIZATION tests, written BEFORE Coaches and Team Page move onto
// BaseListComponent (2026-08-27 sweep, P4).
//
// These two screens are TWINS OF EACH OTHER and of BaseListComponent, which
// neither used - byte-identical SCSS (md5 08c412a1...), byte-identical column
// arrays differing only in the model type, the same organizations lookup, and
// the same delete method. But they are NOT interchangeable, and that is the
// thing these tests exist to protect:
//
//   - DIFFERENT COLLECTIONS. Coaches reads `coaches` (breakout instructors);
//     Team Page reads `impact_team` (the public "My Team" page). They were
//     split apart deliberately in 2026-08 precisely because one record was
//     serving two unrelated purposes.
//   - DIFFERENT ADD BEHAVIOUR. Coaches is EDIT-ONLY by decision: new coaches
//     are created only from the Summit agenda's quick-create dialog, and this
//     roster exists to maintain the fuller profile afterwards. Team Page has
//     a normal permission-gated New.
//
// So they extend the base SEPARATELY. Anything here that starts failing means
// the extraction flattened a difference that was deliberate.

class FakePermissions {
  add = false;
  edit = false;
  del = false;
  canAdd(): boolean { return this.add; }
  canEdit(): boolean { return this.edit; }
  canDelete(): boolean { return this.del; }
}

function harness(rows: unknown[] = []) {
  const permissions = new FakePermissions();
  const deleted: string[] = [];
  const service = {
    streamAll: () => of(rows),
    delete: (id: string) => { deleted.push(id); return Promise.resolve(); },
  };
  const organizationService = {
    streamAll: () => new BehaviorSubject([{ id: 'o1', name: 'Acme' }]),
  };
  const dialog = { open: jasmine.createSpy('open') };
  const confirmService = { confirm: () => Promise.resolve(true) };
  const snackbar = { success: jasmine.createSpy('success') };

  return {
    permissions, deleted, dialog, snackbar,
    args: [service, organizationService, permissions, dialog, confirmService, snackbar],
  };
}

interface ListLike {
  itemType: string;
  columns: { key: string; label: string }[];
  headerActions: unknown[];
  rowActions: { visible: () => boolean }[];
  organizations: { id: string; name: string }[];
  organizationName(item: unknown): string;
  ngOnInit(): void;
  ngOnDestroy?(): void;
  delete(item: unknown): void;
}

describe('Coaches and Team Page (characterization, pre-extraction)', () => {
  describe('CoachesComponent', () => {
    it('is EDIT-ONLY - no New action even with the add permission', () => {
      // The 2026-08-19 decision: coaches are created from the Summit
      // agenda's quick-create dialog, never from this roster.
      const h = harness();
      h.permissions.add = true;
      const c = new (CoachesComponent as never as new (...a: unknown[]) => ListLike)(
        ...(h.args as never[])
      );
      c.ngOnInit();
      expect(c.headerActions)
        .withContext('granting add must NOT give this roster a New button')
        .toEqual([]);
      c.ngOnDestroy?.();
    });

    it('names itself Coach and carries the shared seven columns', () => {
      const h = harness();
      const c = new (CoachesComponent as never as new (...a: unknown[]) => ListLike)(
        ...(h.args as never[])
      );
      expect(c.itemType).toBe('Coach');
      expect(c.columns.map((col) => col.key)).toEqual([
        'isActive', 'photoUrl', 'sortOrder', 'lastName', 'firstName',
        'title', 'organization',
      ]);
    });

    it('hides delete without the permission and deletes with it', () => {
      const h = harness();
      const c = new (CoachesComponent as never as new (...a: unknown[]) => ListLike)(
        ...(h.args as never[])
      );
      expect(c.rowActions[0].visible()).toBe(false);
      h.permissions.del = true;
      expect(c.rowActions[0].visible()).toBe(true);
    });

    it('resolves an organization name, and blanks an unknown one', () => {
      const h = harness();
      const c = new (CoachesComponent as never as new (...a: unknown[]) => ListLike)(
        ...(h.args as never[])
      );
      c.ngOnInit();
      expect(c.organizationName({ organization: 'o1' })).toBe('Acme');
      expect(c.organizationName({ organization: { id: 'o1' } })).toBe('Acme');
      expect(c.organizationName({ organization: 'nope' })).toBe('');
      expect(c.organizationName({})).toBe('');
      c.ngOnDestroy?.();
    });
  });

  describe('TeamPageComponent', () => {
    it('DOES offer New, gated on the add permission', () => {
      const h = harness();
      const withOut = new (TeamPageComponent as never as new (...a: unknown[]) => ListLike)(
        ...(h.args as never[])
      );
      withOut.ngOnInit();
      expect(withOut.headerActions).toEqual([]);
      withOut.ngOnDestroy?.();

      const h2 = harness();
      h2.permissions.add = true;
      const withIt = new (TeamPageComponent as never as new (...a: unknown[]) => ListLike)(
        ...(h2.args as never[])
      );
      withIt.ngOnInit();
      expect(withIt.headerActions.length)
        .withContext('Team Page is not edit-only - it must offer New')
        .toBe(1);
      withIt.ngOnDestroy?.();
    });

    it('names itself Team Member - a different entity from a Coach', () => {
      const h = harness();
      const t = new (TeamPageComponent as never as new (...a: unknown[]) => ListLike)(
        ...(h.args as never[])
      );
      expect(t.itemType).toBe('Team Member');
    });

    it('carries the same seven columns as Coaches', () => {
      // Identical column SHAPE over a different model is exactly why these
      // two look like duplicates; the datasets are what differ.
      const h = harness();
      const t = new (TeamPageComponent as never as new (...a: unknown[]) => ListLike)(
        ...(h.args as never[])
      );
      expect(t.columns.map((col) => col.key)).toEqual([
        'isActive', 'photoUrl', 'sortOrder', 'lastName', 'firstName',
        'title', 'organization',
      ]);
    });

    it('hides delete without the permission', () => {
      const h = harness();
      const t = new (TeamPageComponent as never as new (...a: unknown[]) => ListLike)(
        ...(h.args as never[])
      );
      expect(t.rowActions[0].visible()).toBe(false);
      h.permissions.del = true;
      expect(t.rowActions[0].visible()).toBe(true);
    });
  });

  describe('the two are NOT interchangeable', () => {
    it('read different services - coaches vs impact_team', async () => {
      // The split exists because one record was serving two purposes. If an
      // extraction ever pointed both at one service, this fails.
      const coachRows = [{ id: 'c1', firstName: 'Ada' }];
      const teamRows = [{ id: 't1', firstName: 'Grace' }];

      const hc = harness(coachRows);
      const c = new (CoachesComponent as never as new (...a: unknown[]) => ListLike)(
        ...(hc.args as never[])
      );
      c.ngOnInit();

      const ht = harness(teamRows);
      const t = new (TeamPageComponent as never as new (...a: unknown[]) => ListLike)(
        ...(ht.args as never[])
      );
      t.ngOnInit();

      const cRows = await new Promise((res) =>
        (c as unknown as { coaches$: { subscribe(f: (v: unknown) => void): void } })
          .coaches$.subscribe(res));
      const tRows = await new Promise((res) =>
        (t as unknown as { members$: { subscribe(f: (v: unknown) => void): void } })
          .members$.subscribe(res));

      expect(cRows).toEqual(coachRows);
      expect(tRows).toEqual(teamRows);
      c.ngOnDestroy?.();
      t.ngOnDestroy?.();
    });
  });
});
