import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { LoggerService } from 'src/app/common/services/data/logger.service';
import {
  LibraryUnsavedChangesEditor,
  libraryUnsavedChangesGuard,
} from './library-unsaved-changes.guard';

// A FUNCTIONAL guard, so `inject()` is the only option it has - there is no
// constructor to put dependencies in. This is the shape to copy when testing
// guards, interceptors and resolvers as the apps move to `inject()`.
//
// The guard is invoked inside TestBed.runInInjectionContext, which is what
// opens the injection context its `inject(EnvironmentInjector)` needs. The
// dynamic imports inside it resolve for real (this runs in a browser), and
// the tokens they then inject resolve to the fakes registered below.
//
// What is actually at stake: this guard is the only thing standing between
// an author and silently losing unsaved lesson work.

function editor(over: Partial<LibraryUnsavedChangesEditor> = {}): LibraryUnsavedChangesEditor {
  return { hasUnsavedChanges: () => true, save: () => Promise.resolve(), ...over };
}

interface Harness {
  opened: number;
  snacks: string[];
  logged: string[];
}

function setup(dialogResult: 'save' | 'discard' | undefined): Harness {
  const harness: Harness = { opened: 0, snacks: [], logged: [] };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: MatDialog,
        useValue: {
          open: () => {
            harness.opened++;
            return { afterClosed: () => of(dialogResult) };
          },
        },
      },
      {
        provide: MatSnackBar,
        useValue: { open: (message: string) => harness.snacks.push(message) },
      },
      {
        provide: LoggerService,
        useValue: {
          logMessage: (_area: string, _who: string, message: string) => {
            harness.logged.push(message);
            return of(null);
          },
        },
      },
      {
        provide: AdminAuthService,
        useValue: { dao: { loggedInUser$: of({ email: 'ada@test.local' }) } },
      },
    ],
  });

  return harness;
}

/** Runs the guard the way the router would, inside an injection context. */
function runGuard(
  component: LibraryUnsavedChangesEditor,
  beforeSave?: (c: LibraryUnsavedChangesEditor) => void,
): Promise<boolean> {
  const guard = libraryUnsavedChangesGuard<LibraryUnsavedChangesEditor>(
    'lesson', 'Could not save your lesson.', beforeSave);
  return TestBed.runInInjectionContext(
    () => guard(component, null as never, null as never, null as never),
  ) as Promise<boolean>;
}

describe('libraryUnsavedChangesGuard', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('lets a clean editor leave without prompting at all', async () => {
    const harness = setup('save');
    const allowed = await runGuard(editor({ hasUnsavedChanges: () => false }));
    expect(allowed).toBeTrue();
    expect(harness.opened).toBe(0);
  });

  it('prompts when there are unsaved changes', async () => {
    const harness = setup('discard');
    await runGuard(editor());
    expect(harness.opened).toBe(1);
  });

  it('lets the author leave and lose the changes on discard', async () => {
    setup('discard');
    let saved = false;
    const allowed = await runGuard(editor({ save: async () => { saved = true; } }));
    expect(allowed).toBeTrue();
    expect(saved).withContext('discard must not save').toBeFalse();
  });

  it('keeps the author on the page when the prompt is dismissed', async () => {
    // Closing the dialog without choosing means "I did not mean to leave".
    setup(undefined);
    const allowed = await runGuard(editor());
    expect(allowed).toBeFalse();
  });

  it('saves and then leaves on save', async () => {
    setup('save');
    let saved = false;
    const allowed = await runGuard(editor({ save: async () => { saved = true; } }));
    expect(saved).toBeTrue();
    expect(allowed).toBeTrue();
  });

  it('runs beforeSave first, so a pending merge is not dropped', async () => {
    setup('save');
    const order: string[] = [];
    const allowed = await runGuard(
      editor({ save: async () => { order.push('save'); } }),
      () => order.push('beforeSave'),
    );
    expect(order).toEqual(['beforeSave', 'save']);
    expect(allowed).toBeTrue();
  });

  describe('when the save fails', () => {
    const failing = () => editor({ save: () => Promise.reject(new Error('offline')) });

    it('keeps the author on the page rather than navigating away', async () => {
      // Leaving here would discard the very changes the save was meant to
      // preserve - the worst possible outcome for this guard.
      setup('save');
      expect(await runGuard(failing())).toBeFalse();
    });

    it('tells the author, rather than failing silently', async () => {
      const harness = setup('save');
      await runGuard(failing());
      expect(harness.snacks).toEqual(['Could not save your lesson.']);
    });

    it('logs the failure against the signed-in user', async () => {
      const harness = setup('save');
      await runGuard(failing());
      expect(harness.logged.length).toBe(1);
      expect(harness.logged[0]).toContain('lesson');
      expect(harness.logged[0]).toContain('offline');
    });
  });
});
