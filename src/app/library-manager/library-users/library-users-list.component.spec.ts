import { of } from 'rxjs';
import { LibraryUser } from 'src/app/common/models/domain/library/library-user.model';
import { LibraryUsersListComponent } from './library-users-list.component';

// CHARACTERIZATION tests, written 2026-08-21 BEFORE swapping this screen's
// hand-rolled mat-table for the shared <app-data-grid> (bucket A item #1).
//
// This is the screen where the swap changes the most, so the labels and the
// messaging flow are pinned first:
//  - an international user's effective access is EVERY book regardless of
//    what licensedBookIds actually holds;
//  - "Sent to N users" wording distinguishes device notifications from the
//    reader-app inbox copy, because push is best-effort and the inbox is not;
//  - the selection is cleared only after a SUCCESSFUL send.
//
// House style: hand-constructed with duck-typed deps, no TestBed.

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    libraryUserService: {
      getLibraryUsersPage: jasmine.createSpy('getLibraryUsersPage')
        .and.returnValue(Promise.resolve({ items: [], cursor: null })),
    },
    dialog: { open: jasmine.createSpy('open').and.returnValue({ afterClosed: () => of(undefined) }) },
    snackbar: { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') },
    router: { navigate: jasmine.createSpy('navigate').and.returnValue(Promise.resolve(true)) },
    ...overrides,
  };
}

function makeComponent(overrides: Record<string, unknown> = {}) {
  const d = makeDeps(overrides);
  const component = new LibraryUsersListComponent(
    d.libraryUserService as never,
    d.dialog as never,
    d.snackbar as never,
    d.router as never,
  );
  return { component, deps: d };
}

const aUser = (extra: Partial<LibraryUser> = {}): LibraryUser =>
  ({ id: 'a@test.local', email: 'a@test.local', firstName: 'Ada', lastName: 'Lovelace', ...extra }) as LibraryUser;

/** A dialog stub that closes with `result`. */
const dialogReturning = (result: unknown) => ({ open: () => ({ afterClosed: () => of(result) }) });

describe('LibraryUsersListComponent', () => {
  describe('display labels', () => {
    it('joins the name, tolerating a missing half', () => {
      const { component } = makeComponent();
      expect(component.userName(aUser())).toBe('Ada Lovelace');
      expect(component.userName(aUser({ lastName: '' }))).toBe('Ada');
    });

    it('joins city, region and country, skipping the blanks', () => {
      const { component } = makeComponent();
      expect(component.locationLabel(aUser({ location: { city: 'Leeds', country: 'UK' } } as Partial<LibraryUser>)))
        .toBe('Leeds, UK');
      expect(component.locationLabel(aUser())).toBe('');
    });

    it('reports an international user as having ALL books', () => {
      // Their effective access ignores the stored array entirely.
      const { component } = makeComponent();
      const user = aUser({ internationalUser: true, licensedBookIds: [] } as Partial<LibraryUser>);
      expect(component.licenseLabel(user)).toBe('All books');
    });

    it('counts licences, singular and plural', () => {
      const { component } = makeComponent();
      expect(component.licenseLabel(aUser({ licensedBookIds: ['b1'] } as Partial<LibraryUser>))).toBe('1 book');
      expect(component.licenseLabel(aUser({ licensedBookIds: ['b1', 'b2'] } as Partial<LibraryUser>))).toBe('2 books');
      expect(component.licenseLabel(aUser())).toBe('0 books');
    });
  });

  describe('open', () => {
    it('routes to the user detail screen', () => {
      const { component, deps } = makeComponent();
      component.openDetail(aUser({ id: 'z@test.local' }));
      expect(deps.router.navigate).toHaveBeenCalledWith(['/library-manager/library-users', 'z@test.local']);
    });
  });

  describe('messaging', () => {
    it('does nothing when nothing is selected', async () => {
      const { component, deps } = makeComponent();
      await component.messageSelected();
      expect(deps.dialog.open).not.toHaveBeenCalled();
    });

    it('messages ALL with a label that flags the revoked-user exclusion', async () => {
      const opened: { data: { recipients: unknown; recipientLabel: string } }[] = [];
      const { component } = makeComponent({
        dialog: {
          open: (_c: unknown, config: { data: { recipients: unknown; recipientLabel: string } }) => {
            opened.push(config);
            return { afterClosed: () => of(undefined) };
          },
        },
      });
      await component.messageAll();
      expect(opened[0].data.recipients).toBe('all');
      expect(opened[0].data.recipientLabel).toContain('revoked users excluded');
    });

    it('reports the send, separating device notifications from the inbox copy', async () => {
      // Push is best-effort; the inbox copy is not. The wording has to keep
      // those apart or a partial push reads as a partial send.
      const { component, deps } = makeComponent({
        dialog: dialogReturning({ recipientCount: 3, pushSuccessCount: 2 }),
      });
      await component.messageAll();

      const message = deps.snackbar.success.calls.mostRecent().args[0] as string;
      expect(message).toContain('Sent to 3 users');
      expect(message).toContain('2 device notifications delivered');
      expect(message).toContain('reader-app inbox');
    });

    it('uses singular wording for a single recipient', async () => {
      const { component, deps } = makeComponent({
        dialog: dialogReturning({ recipientCount: 1, pushSuccessCount: 1 }),
      });
      await component.messageAll();
      const message = deps.snackbar.success.calls.mostRecent().args[0] as string;
      expect(message).toContain('Sent to 1 user ');
      expect(message).toContain('1 device notification delivered');
    });

    it('does NOT report anything when the dialog is cancelled', async () => {
      const { component, deps } = makeComponent({ dialog: dialogReturning(undefined) });
      await component.messageAll();
      expect(deps.snackbar.success).not.toHaveBeenCalled();
    });
  });
});
