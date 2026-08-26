import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { LibraryUser } from 'src/app/common/models/domain/library/library-user.model';
import { LibraryUserService } from 'src/app/common/services/data/library/library-user.service';
import { LibraryDiscussionGroupService } from 'src/app/common/services/data/library/library-discussion-group.service';
import { LibraryBookService } from 'src/app/common/services/data/library/library-book.service';
import { DiscussionGroup, GroupMembership } from '@impact-common/models/discussion-group.model';
import { DigitalBookUserReportComponent } from './digital-book-user-report.component';

// The whole report is one four-way client-side join, so that join IS the
// thing worth testing - everything else on the screen (filter row, sorting,
// Columns menu, Excel export) belongs to <app-data-grid> and is covered by
// its own specs. The cases pinned here are the ones easy to get subtly wrong:
//
//  - a group's CREATOR also has an 'approved' member doc of their own, so a
//    naive join reports every leader as "Leader & Member" of their own group;
//  - 'rejected' requests must not count as belonging, while 'pending' must
//    still be visible (the whole point of showing pending distinctly);
//  - an international patron reads the entire catalog regardless of
//    licensedBookIds, so counting licences would understate their access;
//  - LibraryUser.createdAt is a bare epoch NUMBER, and the grid's date
//    columns silently render a number as blank unless it's a real Date.
//
// Minimal all-stub TestBed-as-injector: the component uses signals/computed,
// which need an injection context. Nothing here touches Firebase.

describe('DigitalBookUserReportComponent', () => {
  let component: DigitalBookUserReportComponent;

  const aUser = (extra: Partial<LibraryUser> = {}): LibraryUser =>
    ({
      id: 'pat@test.local',
      email: 'pat@test.local',
      firstName: 'Pat',
      lastName: 'Patron',
      createdAt: 1_700_000_000_000,
      licensedBookIds: ['b-1'],
      ...extra
    }) as LibraryUser;

  const aGroup = (extra: Partial<DiscussionGroup> = {}): DiscussionGroup =>
    ({
      id: 'g-1',
      title: 'Tuesday Group',
      bookId: 'b-1',
      creatorEmail: 'leader@test.local',
      creatorDisplayName: 'Lee Leader',
      status: 'open',
      ...extra
    }) as DiscussionGroup;

  const aMembership = (extra: Partial<GroupMembership> = {}): GroupMembership =>
    ({
      groupId: 'g-1',
      email: 'pat@test.local',
      displayName: 'Pat Patron',
      status: 'approved',
      requestedAt: 1,
      ...extra
    }) as GroupMembership;

  function configure(
    users: LibraryUser[],
    groups: DiscussionGroup[] = [],
    memberships: GroupMembership[] = [],
    books: { id: string; title: string }[] = [{ id: 'b-1', title: 'Book One' }]
  ): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        DigitalBookUserReportComponent,
        { provide: LibraryUserService, useValue: { getLibraryUsers: () => of(users) } },
        {
          provide: LibraryDiscussionGroupService,
          useValue: {
            getAllGroups: () => of(groups),
            getAllMemberships: () => Promise.resolve(memberships)
          }
        },
        { provide: LibraryBookService, useValue: { getAll: () => Promise.resolve(books) } }
      ]
    });
    component = TestBed.inject(DigitalBookUserReportComponent);
  }

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve));

  describe('ordering', () => {
    it('lists newest signup first, with a missing createdAt at the bottom', async () => {
      configure([
        aUser({ id: 'old@test.local', email: 'old@test.local', createdAt: 1_000 }),
        aUser({ id: 'none@test.local', email: 'none@test.local', createdAt: undefined }),
        aUser({ id: 'new@test.local', email: 'new@test.local', createdAt: 9_000 })
      ]);
      await flush();
      expect(component.rows().map((r) => r.email)).toEqual(['new@test.local', 'old@test.local', 'none@test.local']);
    });

    it('exposes signedUp as a real Date, not the raw epoch number', async () => {
      configure([aUser({ createdAt: 1_700_000_000_000 })]);
      await flush();
      expect(component.rows()[0].signedUp instanceof Date).toBe(true);
      expect(component.rows()[0].signedUp!.getTime()).toBe(1_700_000_000_000);
    });

    it('leaves signedUp null when the doc has no createdAt', async () => {
      configure([aUser({ createdAt: undefined })]);
      await flush();
      expect(component.rows()[0].signedUp).toBeNull();
    });
  });

  describe('group standing', () => {
    it('does not double-count a leader who also has their own member doc', async () => {
      configure(
        [aUser({ id: 'leader@test.local', email: 'leader@test.local' })],
        [aGroup()],
        [aMembership({ email: 'leader@test.local', status: 'approved' })]
      );
      await flush();
      expect(component.rows()[0].groupRole).toBe('Leader');
      expect(component.rows()[0].groups).toBe('Tuesday Group (leads)');
    });

    it('reports Leader & Member only across DIFFERENT groups', async () => {
      configure(
        [aUser({ id: 'leader@test.local', email: 'leader@test.local' })],
        [aGroup(), aGroup({ id: 'g-2', title: 'Thursday Group', creatorEmail: 'other@test.local' })],
        [aMembership({ email: 'leader@test.local' }), aMembership({ email: 'leader@test.local', groupId: 'g-2' })]
      );
      await flush();
      expect(component.rows()[0].groupRole).toBe('Leader & Member');
      expect(component.rows()[0].groups).toBe('Tuesday Group (leads), Thursday Group (member)');
    });

    it('shows a pending request distinctly, as its own role', async () => {
      configure([aUser()], [aGroup()], [aMembership({ status: 'pending' })]);
      await flush();
      expect(component.rows()[0].groupRole).toBe('Pending');
      expect(component.rows()[0].groups).toBe('Tuesday Group (pending)');
    });

    it('ignores a rejected request entirely', async () => {
      configure([aUser()], [aGroup()], [aMembership({ status: 'rejected' })]);
      await flush();
      expect(component.rows()[0].groupRole).toBe('');
      expect(component.rows()[0].groups).toBe('');
    });

    it('matches emails case-insensitively across both joins', async () => {
      configure(
        [aUser({ id: 'lee@test.local', email: 'Lee@Test.Local' })],
        [aGroup({ creatorEmail: 'LEE@test.local' })],
        []
      );
      await flush();
      expect(component.rows()[0].groupRole).toBe('Leader');
    });

    it('falls back to the group id when a membership outlives its group doc', async () => {
      configure([aUser()], [], [aMembership({ groupId: 'g-gone' })]);
      await flush();
      expect(component.rows()[0].groups).toBe('g-gone (member)');
    });
  });

  describe('book access', () => {
    it('resolves licensed book titles, keeping an unknown id visible', async () => {
      configure([aUser({ licensedBookIds: ['b-1', 'b-missing'] })]);
      await flush();
      expect(component.rows()[0].bookTitles).toBe('Book One, b-missing');
      expect(component.rows()[0].licensedBookCount).toBe(2);
      expect(component.rows()[0].access).toBe('Licensed');
    });

    it('reports an international patron as having the whole catalog', async () => {
      configure([aUser({ internationalUser: true, licensedBookIds: [] })]);
      await flush();
      expect(component.rows()[0].access).toBe('International');
      expect(component.rows()[0].bookTitles).toBe('All books (international)');
    });

    it('treats a patron with no licences and no international flag as None', async () => {
      configure([aUser({ licensedBookIds: [] })]);
      await flush();
      // The default view filters a no-access row out - switch it off to see it.
      component.onlyWithBookAccess.set(false);
      expect(component.rows()[0].access).toBe('None');
    });
  });

  describe('the Has book access toggle', () => {
    it('hides no-access rows by default and reveals them when switched off', async () => {
      configure([
        aUser({ id: 'has@test.local', email: 'has@test.local', licensedBookIds: ['b-1'] }),
        aUser({ id: 'not@test.local', email: 'not@test.local', licensedBookIds: [] })
      ]);
      await flush();

      expect(component.rows().map((r) => r.email)).toEqual(['has@test.local']);
      expect(component.totalCount()).toBe(2);

      component.onlyWithBookAccess.set(false);
      expect(component.rows().length).toBe(2);
    });
  });

  describe('status', () => {
    it('surfaces a revoked patron', async () => {
      configure([aUser({ revoked: true })]);
      await flush();
      expect(component.rows()[0].status).toBe('REVOKED');
    });
  });

  describe('failure', () => {
    it('shows an error and empties the table rather than half-rendering a join', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          DigitalBookUserReportComponent,
          { provide: LibraryUserService, useValue: { getLibraryUsers: () => of([aUser()]) } },
          {
            provide: LibraryDiscussionGroupService,
            useValue: {
              getAllGroups: () => of([]),
              getAllMemberships: () => Promise.reject(new Error('permission-denied'))
            }
          },
          { provide: LibraryBookService, useValue: { getAll: () => Promise.resolve([]) } }
        ]
      });
      component = TestBed.inject(DigitalBookUserReportComponent);
      await flush();

      expect(component.rows()).toEqual([]);
      expect(component.error()).toContain('permission-denied');
      expect(component.loading()).toBe(false);
    });
  });
});
