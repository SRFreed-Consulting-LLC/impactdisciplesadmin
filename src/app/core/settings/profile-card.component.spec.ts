import { BehaviorSubject, of } from 'rxjs';
import { ProfileCardComponent } from './profile-card.component';
import { AdminUser } from 'src/app/common/models/admin/admin-user.model';

// Settings > My Profile, added 2026-08-29 - the one screen where a member of
// staff writes to their OWN admin_users record.
//
// Two things here are load-bearing rather than cosmetic, and both fail
// silently:
//
//   - the write must be PARTIAL. A whole-record write would carry this
//     component's cached copy of every preference back to Firestore, and
//     firestore.rules would refuse it outright for anyone but Admin/Root -
//     the self-account carve-out is a hasOnly() allow-list, so a write that
//     lists every field as changed is denied.
//   - only the NAME may reach the shared currentAgent$ copy. That copy is
//     fed once at sign-in and is stale with respect to any preference
//     written since, so pushing it back wholesale would revert the drawer
//     width or the theme the moment somebody saved their name.
//
// Hand-constructed with duck-typed deps, the house style for this suite.

interface Harness {
  card: ProfileCardComponent;
  writes: Array<{ id: string; payload: Record<string, unknown> }>;
  currentAgent$: BehaviorSubject<AdminUser | null>;
  reject: (err: unknown) => void;
}

function setup(user: Partial<AdminUser> = {}, failWrite = false): Harness {
  const stored = {
    id: 'a-emp', email: 'employee@test.local', role: 'Employee',
    firstName: 'Sam', lastName: 'Taylor',
    // The preferences a whole-record write would clobber.
    drawerWidth: 420, colorTheme: 'horizon',
    ...user
  } as AdminUser;

  // The SHARED copy deliberately differs from the one this component
  // loaded. It has to, or a spec asserting "the name is merged onto the
  // shared copy" would pass just as happily against an implementation that
  // replaced it with this component's own - the two would be identical.
  const currentAgent$ = new BehaviorSubject<AdminUser | null>(
    { ...stored, drawerWidth: 999 } as AdminUser
  );
  const writes: Array<{ id: string; payload: Record<string, unknown> }> = [];

  const authService = { dao: { loggedInUser$: of(stored), currentAgent$ } };
  const adminUserService = {
    updateFields: (id: string, payload: Record<string, unknown>) => {
      writes.push({ id, payload });
      return failWrite ? Promise.reject(new Error('permission-denied')) : Promise.resolve();
    }
  };

  const card = new ProfileCardComponent(authService as never, adminUserService as never);
  card.ngOnInit();
  return { card, writes, currentAgent$, reject: () => undefined };
}

describe('Settings > My Profile', () => {
  it('loads the signed-in person into the form', () => {
    const { card } = setup();

    expect(card.firstName).toBe('Sam');
    expect(card.lastName).toBe('Taylor');
    expect(card.email).toBe('employee@test.local');
    expect(card.role).toBe('Employee');
  });

  it('is not saveable until something changes', () => {
    const { card } = setup();

    expect(card.dirty).toBeFalse();
    expect(card.canSave).toBeFalse();

    card.firstName = 'Samantha';

    expect(card.dirty).toBeTrue();
    expect(card.canSave).toBeTrue();
  });

  it('refuses to save a blank first name', () => {
    // The top bar falls back to the raw email address without one, which
    // reads as an account that has lost its profile.
    const { card } = setup();

    card.firstName = '   ';

    expect(card.dirty).toBeTrue();
    expect(card.canSave).toBeFalse();
  });

  it('treats whitespace-only edits as no change', () => {
    const { card } = setup();

    card.firstName = '  Sam  ';

    expect(card.dirty).toBeFalse();
  });

  it('writes ONLY the two name fields', async () => {
    const { card, writes } = setup();

    card.firstName = 'Samantha';
    card.save();
    await Promise.resolve();

    expect(writes.length).toBe(1);
    expect(writes[0].id).toBe('a-emp');
    expect(writes[0].payload).toEqual({ firstName: 'Samantha', lastName: 'Taylor' });
  });

  it('trims what it saves', async () => {
    const { card, writes } = setup();

    card.firstName = '  Samantha  ';
    card.lastName = '  Rivers ';
    card.save();
    await Promise.resolve();

    expect(writes[0].payload).toEqual({ firstName: 'Samantha', lastName: 'Rivers' });
  });

  it('publishes the new name without disturbing the saved preferences', async () => {
    // The shell's top bar reads the shared copy. Replacing that copy
    // wholesale would push a stale drawerWidth/colorTheme back over the
    // live ones - so only the name may travel.
    const { card, currentAgent$ } = setup();

    card.firstName = 'Samantha';
    card.save();
    await Promise.resolve();

    const published = currentAgent$.value as AdminUser;
    expect(published.firstName).toBe('Samantha');
    // 999 is what the SHARED copy held - not the 420 this component loaded.
    // Getting 420 here means the shared copy was replaced with this
    // component's own rather than having the name merged onto it.
    expect(published.drawerWidth).toBe(999);
    expect(published.colorTheme).toBe('horizon');
  });

  it('reports a refused write instead of reverting in silence', async () => {
    // The write CAN legitimately be refused, and a silent revert is what
    // makes people think the app is broken.
    const { card } = setup({}, true);

    card.firstName = 'Samantha';
    card.save();
    await Promise.resolve();
    await Promise.resolve();

    expect(card.saving).toBeFalse();
    expect(card.saved).toBeFalse();
    expect(card.error).toBeTruthy();
  });

  it('retires the last outcome as soon as the text changes again', async () => {
    const { card } = setup();

    card.firstName = 'Samantha';
    card.save();
    await Promise.resolve();
    expect(card.saved).toBeTrue();

    card.firstName = 'Sam';
    card.onEdited();

    expect(card.saved).toBeFalse();
  });

  it('reverts to what is stored, not to blank', () => {
    const { card } = setup();

    card.firstName = 'Whoops';
    card.lastName = '';
    card.revert();

    expect(card.firstName).toBe('Sam');
    expect(card.lastName).toBe('Taylor');
    expect(card.dirty).toBeFalse();
  });
});
