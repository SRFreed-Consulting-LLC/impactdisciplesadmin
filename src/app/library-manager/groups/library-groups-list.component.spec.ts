import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { ConfirmService } from 'src/app/shared/confirm-dialog/confirm.service';
import { SnackbarService } from 'src/app/shared/snackbar.service';
import { LibraryDiscussionGroupService } from 'src/app/common/services/data/library/library-discussion-group.service';
import { LibraryBookService } from 'src/app/common/services/data/library/library-book.service';
import { LibraryErrorLogService } from 'src/app/common/services/data/library/library-error-log.service';
import { DiscussionGroup } from '@impact-common/models/discussion-group.model';
import { LibraryGroupsListComponent } from './library-groups-list.component';

// CHARACTERIZATION tests, written 2026-08-21 BEFORE swapping this screen's
// hand-rolled mat-table for the shared <app-data-grid> (bucket A item #1).
//
// Two things here are easy to get subtly wrong and are pinned first:
//  - meeting type is DERIVED from which location fields a group carries,
//    and "hybrid" means it has both, not a stored flag;
//  - the row's member count is a DENORMALIZED counter, but the edit dialog
//    fetches a live, exact approved count instead - because that value
//    feeds maxMembers validation and the counter can be absent on older
//    groups. Collapsing the two would let an admin over-fill a group.
//
// Minimal all-stub TestBed: the component uses signals/computed, which need
// an injection context. Nothing here touches Firebase.

describe('LibraryGroupsListComponent', () => {
  let component: LibraryGroupsListComponent;
  let updated: { id: string; result: unknown }[];
  let deletedIds: string[];
  let snackbar: { success: jasmine.Spy; error: jasmine.Spy };
  let logged: unknown[];
  let confirmResult: boolean;
  let dialogResult: unknown;
  let members: { status: string; email: string }[];
  let lastDialogData: { currentApprovedMemberCount: number } | null;

  const aGroup = (extra: Partial<DiscussionGroup> = {}): DiscussionGroup =>
    ({
      id: 'g-1',
      title: 'Tuesday Group',
      bookId: 'b-1',
      creatorEmail: 'leader@test.local',
      creatorDisplayName: 'Lee Leader',
      status: 'open',
      ...extra,
    }) as DiscussionGroup;

  function configure(groups: DiscussionGroup[], books: { id: string; title: string }[] = []): void {
    updated = [];
    deletedIds = [];
    logged = [];
    confirmResult = true;
    dialogResult = undefined;
    members = [];
    lastDialogData = null;
    snackbar = { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        LibraryGroupsListComponent,
        {
          provide: LibraryDiscussionGroupService,
          useValue: {
            getAllGroups: () => of(groups),
            getGroupMembers: () => of(members),
            updateGroup: (id: string, result: unknown) => { updated.push({ id, result }); return Promise.resolve(); },
            deleteGroup: (id: string) => { deletedIds.push(id); return Promise.resolve(); },
          },
        },
        { provide: LibraryBookService, useValue: { getAll: () => Promise.resolve(books) } },
        { provide: ConfirmService, useValue: { confirm: () => Promise.resolve(confirmResult) } },
        { provide: SnackbarService, useValue: snackbar },
        {
          provide: MatDialog,
          useValue: {
            open: (_c: unknown, config: { data: { currentApprovedMemberCount: number } }) => {
              lastDialogData = config.data;
              return { afterClosed: () => of(dialogResult) };
            },
          },
        },
        { provide: LibraryErrorLogService, useValue: { logError: (...args: unknown[]) => logged.push(args) } },
      ],
    });
    component = TestBed.inject(LibraryGroupsListComponent);
  }

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve));

  describe('rows', () => {
    it('resolves the book title, and says so when the book is unknown', async () => {
      configure([aGroup({ bookId: 'b-1' }), aGroup({ id: 'g-2', bookId: 'missing' })],
        [{ id: 'b-1', title: 'Book One' }]);
      await flush();
      expect(component.visibleRows()[0].bookTitle).toBe('Book One');
      expect(component.visibleRows()[1].bookTitle).toBe('Unknown book');
    });

    it('derives meeting type from which location fields exist', () => {
      configure([
        aGroup({ id: 'a', inPersonLocation: 'Hall' } as Partial<DiscussionGroup>),
        aGroup({ id: 'b', onlineInfo: 'zoom link' } as Partial<DiscussionGroup>),
        aGroup({ id: 'c', inPersonLocation: 'Hall', onlineInfo: 'zoom link' } as Partial<DiscussionGroup>),
      ]);
      expect(component.visibleRows().map((r) => r.meetingType))
        .toEqual(['in-person', 'online', 'hybrid']);
    });

    it('defaults the denormalized counters to 0 for groups predating them', () => {
      configure([aGroup()]);
      expect(component.visibleRows()[0].memberCount).toBe(0);
      expect(component.visibleRows()[0].pendingCount).toBe(0);
    });
  });

  describe('edit', () => {
    it('passes a LIVE approved count, excluding the leader, to the wizard', async () => {
      // The row's memberCount is a denormalized counter and may be stale or
      // absent; this value drives maxMembers validation so it is fetched.
      configure([aGroup()]);
      // After configure(), which resets the stub state.
      members = [
        { status: 'approved', email: 'a@test.local' },
        { status: 'approved', email: 'leader@test.local' },
        { status: 'pending', email: 'b@test.local' },
      ];
      await component.openEditDialog(aGroup());
      expect(lastDialogData!.currentApprovedMemberCount).toBe(1);
    });

    it('updates and reports success', async () => {
      configure([aGroup()]);
      dialogResult = { title: 'Renamed' };
      await component.openEditDialog(aGroup({ id: 'g-7' }));
      await flush();
      expect(updated[0].id).toBe('g-7');
      expect(snackbar.success).toHaveBeenCalledWith('Impact Group updated.');
    });

    it('does nothing when the wizard is cancelled', async () => {
      configure([aGroup()]);
      await component.openEditDialog(aGroup());
      expect(updated).toEqual([]);
    });

    it('logs and shows a fixed sentence on failure, never the raw error', async () => {
      configure([aGroup()]);
      dialogResult = { title: 'Renamed' };
      TestBed.inject(LibraryDiscussionGroupService).updateGroup =
        () => Promise.reject(new Error('PERMISSION_DENIED: raw')) as never;
      await component.openEditDialog(aGroup());
      await flush();
      expect(snackbar.error).toHaveBeenCalledWith('Something went wrong saving changes. Please try again.');
      expect(logged.length).toBe(1);
    });
  });

  describe('delete', () => {
    it('confirms with a warning about the cascade, then deletes', async () => {
      configure([aGroup()]);
      await component.deleteGroup(aGroup({ id: 'g-9' }));
      await flush();
      expect(deletedIds).toEqual(['g-9']);
      expect(snackbar.success).toHaveBeenCalledWith('Impact Group deleted.');
    });

    it('does nothing when declined', async () => {
      configure([aGroup()]);
      confirmResult = false;
      await component.deleteGroup(aGroup());
      expect(deletedIds).toEqual([]);
    });
  });
});
