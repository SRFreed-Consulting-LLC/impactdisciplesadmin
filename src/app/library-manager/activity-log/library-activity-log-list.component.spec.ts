import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AdminUserService } from 'src/app/common/services/data/admin-user.service';
import { ConfirmService } from 'src/app/shared/confirm-dialog/confirm.service';
import { LibraryActivityLogService } from 'src/app/common/services/data/library/library-activity-log.service';
import { LibraryActivityLogEntry } from 'src/app/common/models/domain/library/library-activity-log.model';
import { LibraryActivityLogListComponent } from './library-activity-log-list.component';

// CHARACTERIZATION tests, written 2026-08-21 BEFORE swapping this screen's
// hand-rolled mat-table for the shared <app-data-grid> (bucket A item #1).
//
// The behaviour worth pinning is the actor resolution: a row shows the
// CURRENT display name from admin_users, falling back to the name snapshot
// stored on the entry itself - which is what keeps a deleted account's
// history readable instead of showing a bare uid.
//
// Uses a minimal all-stub TestBed because the component takes its
// dependencies through inject()/signals, which need an injection context -
// correct now the module keeps its modern idiom (see CLAUDE.md).

describe('LibraryActivityLogListComponent', () => {
  let component: LibraryActivityLogListComponent;
  let deleted: string[];
  let deletedBatches: string[][];
  let confirmResult: boolean;

  const anEntry = (extra: Partial<LibraryActivityLogEntry> = {}): LibraryActivityLogEntry =>
    ({
      id: 'e-1',
      actorUid: 'uid-1',
      actorName: 'Snapshot Name',
      action: 'book.publish',
      targetName: 'Book One',
      ...extra,
    }) as LibraryActivityLogEntry;

  function configure(
    entries: LibraryActivityLogEntry[],
    users: { firebaseUID: string; firstName?: string; lastName?: string; email?: string }[] = [],
  ): void {
    deleted = [];
    deletedBatches = [];
    confirmResult = true;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        LibraryActivityLogListComponent,
        {
          provide: LibraryActivityLogService,
          useValue: {
            getAllActivity: () => of(entries),
            deleteEntry: (id: string) => { deleted.push(id); return Promise.resolve(); },
            deleteEntries: (ids: string[]) => { deletedBatches.push(ids); return Promise.resolve(); },
          },
        },
        { provide: AdminUserService, useValue: { getAll: () => Promise.resolve(users) } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(confirmResult) } },
      ],
    });
    component = TestBed.inject(LibraryActivityLogListComponent);
  }

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve));

  describe('loading', () => {
    it('fills rows from the stream and clears the spinner', () => {
      configure([anEntry(), anEntry({ id: 'e-2' })]);
      expect(component.rows().length).toBe(2);
      expect(component.loading()).toBeFalse();
    });
  });

  describe('actor resolution', () => {
    it('prefers the CURRENT name from admin_users', async () => {
      configure([anEntry({ actorUid: 'uid-1' })], [
        { firebaseUID: 'uid-1', firstName: 'Ada', lastName: 'Renamed', email: 'ada@test.local' },
      ]);
      await flush();
      expect(component.rows()[0].actorDisplayName).toBe('Ada Renamed');
      expect(component.rows()[0].actorEmail).toBe('ada@test.local');
    });

    it('falls back to the snapshot on the entry for a DELETED account', async () => {
      // Otherwise a removed staff account turns its whole history into uids.
      configure([anEntry({ actorUid: 'gone', actorName: 'Snapshot Name' })], []);
      await flush();
      expect(component.rows()[0].actorDisplayName).toBe('Snapshot Name');
    });
  });

  describe('delete one', () => {
    it('confirms, then deletes that entry', async () => {
      configure([anEntry({ id: 'e-9' })]);
      await component.deleteOne(component.rows()[0]);
      expect(deleted).toEqual(['e-9']);
    });

    it('does nothing when declined', async () => {
      configure([anEntry()]);
      confirmResult = false;
      await component.deleteOne(component.rows()[0]);
      expect(deleted).toEqual([]);
    });
  });

  describe('delete selected', () => {
    it('does nothing when the selection is empty', async () => {
      configure([anEntry()]);
      await component.deleteSelected();
      expect(deletedBatches).toEqual([]);
    });

    it('deletes the whole selection in ONE batch call, then clears it', async () => {
      configure([anEntry({ id: 'e-1' }), anEntry({ id: 'e-2' })]);
      component.selection.select(...component.rows());

      await component.deleteSelected();

      expect(deletedBatches.length).toBe(1);
      expect(deletedBatches[0].sort()).toEqual(['e-1', 'e-2']);
      expect(component.selection.selected.length).toBe(0);
    });

    it('leaves the selection intact when declined', async () => {
      configure([anEntry({ id: 'e-1' })]);
      component.selection.select(component.rows()[0]);
      confirmResult = false;

      await component.deleteSelected();

      expect(deletedBatches).toEqual([]);
      expect(component.selection.selected.length).toBe(1);
    });
  });
});
