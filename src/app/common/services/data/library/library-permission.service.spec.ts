import { BehaviorSubject } from 'rxjs';
import { Role } from '@impact-common/shared/lists/roles.enum';
import { AdminUser } from 'src/app/common/models/admin/admin-user.model';
import { LibraryNodePermission } from 'src/app/common/models/domain/library/library-node-permission.model';
import { LibraryEffectivePermission, LibraryPermissionService } from './library-permission.service';

// LibraryPermissionService decides what an Editor may see and do anywhere in
// the Library section: grants live per content node and propagate DOWN, while
// a node that is merely an ANCESTOR of a granted node must still render so
// Browse stays navigable. Getting either half wrong silently either hides an
// Editor's own content or shows them someone else's, so this pins both.
//
// Hand-constructed with duck-typed deps, matching the house convention
// (permission.service.spec.ts). This used to need a minimal TestBed because
// the service took its dependencies through inject() FIELD initializers;
// those moved into the constructor on 2026-08-21 (bucket A item #7).
// Nothing here touches Firebase or the network.
//
// Not covered here: setPermission(), which is a Firestore transaction
// (runTransaction/doc are module-level @angular/fire functions) - a write
// path that belongs in the emulator suite, not a unit test.

const CONTENT = {
  lessons: {
    'lesson-1': { id: 'lesson-1', unitId: 'unit-1' },
    'lesson-orphan': { id: 'lesson-orphan', unitId: 'unit-missing' }
  } as Record<string, { id: string; unitId: string } | undefined>,
  units: {
    'unit-1': { id: 'unit-1', bookId: 'book-1' }
  } as Record<string, { id: string; bookId: string } | undefined>,
  books: {
    'book-1': { id: 'book-1', seriesId: 'series-1' }
  } as Record<string, { id: string; seriesId: string } | undefined>
};

function permission(overrides: Partial<LibraryNodePermission>): LibraryNodePermission {
  return { nodeType: 'series', nodeId: 'series-1', view: false, add: false, edit: false, delete: false, ...overrides };
}

describe('LibraryPermissionService', () => {
  let user$: BehaviorSubject<AdminUser | null>;
  let service: LibraryPermissionService;
  let lessonLookups: string[];

  /** Signs a user in and lets the async ancestor walk settle. The walk is
   *  a chain of already-resolved promises (lesson -> unit -> book), so a
   *  single macrotask hop drains the whole microtask queue behind it -
   *  deterministic, unlike counting await Promise.resolve() turns. */
  async function signIn(user: AdminUser | null): Promise<void> {
    user$.next(user);
    await new Promise<void>((resolve) => setTimeout(resolve));
  }

  function editorWith(libraryPermissions: LibraryNodePermission[]): AdminUser {
    return { role: Role.EDITOR, libraryPermissions } as AdminUser;
  }

  beforeEach(() => {
    lessonLookups = [];
    user$ = new BehaviorSubject<AdminUser | null>(null);

    service = new LibraryPermissionService(
      {} as never,                                                    // firestore
      { dao: { loggedInUser$: user$ } } as never,                      // authService
      { log: () => Promise.resolve() } as never,                       // activityLog
      {} as never,                                                     // seriesService
      { getById: (id: string) => Promise.resolve(CONTENT.books[id]) } as never,
      { getById: (id: string) => Promise.resolve(CONTENT.units[id]) } as never,
      {
        getById: (id: string) => {
          lessonLookups.push(id);
          return Promise.resolve(CONTENT.lessons[id]);
        }
      } as never,
    );
  });

  describe('isFullAccess', () => {
    it('is true for Admin and (via hasRole) Root', async () => {
      await signIn({ role: Role.ADMIN } as AdminUser);
      expect(service.isFullAccess()).toBeTrue();

      await signIn({ role: Role.ROOT } as AdminUser);
      expect(service.isFullAccess()).toBeTrue();
    });

    it('is false for Editor, Employee and signed-out', async () => {
      await signIn(editorWith([]));
      expect(service.isFullAccess()).toBeFalse();

      await signIn({ role: Role.EMPLOYEE } as AdminUser);
      expect(service.isFullAccess()).toBeFalse();

      await signIn(null);
      expect(service.isFullAccess()).toBeFalse();
    });
  });

  describe('effectivePermission', () => {
    const NONE: LibraryEffectivePermission = { view: false, add: false, edit: false, delete: false };

    it('grants everything to Admin regardless of stored grants', async () => {
      await signIn({ role: Role.ADMIN } as AdminUser);
      expect(service.effectivePermission('lesson', 'anything'))
        .toEqual({ view: true, add: true, edit: true, delete: true });
    });

    it('grants nothing to an Editor with no matching grant', async () => {
      await signIn(editorWith([permission({ nodeId: 'other-series', view: true })]));
      expect(service.effectivePermission('series', 'series-1')).toEqual(NONE);
    });

    it('requires the node TYPE to match, not just the id', async () => {
      await signIn(editorWith([permission({ nodeType: 'book', nodeId: 'shared-id', edit: true })]));
      expect(service.effectivePermission('unit', 'shared-id')).toEqual(NONE);
      expect(service.effectivePermission('book', 'shared-id').edit).toBeTrue();
    });

    it('implies view from any of add/edit/delete', async () => {
      await signIn(editorWith([permission({ nodeId: 'series-1', edit: true })]));
      const real = service.effectivePermission('series', 'series-1');
      expect(real.view).toBeTrue();
      expect(real.edit).toBeTrue();
      expect(real.add).toBeFalse();
      expect(real.delete).toBeFalse();
    });

    it('propagates a parent permission down to the child', async () => {
      await signIn(editorWith([]));
      const parent: LibraryEffectivePermission = { view: true, add: true, edit: false, delete: false };
      expect(service.effectivePermission('book', 'book-1', parent))
        .toEqual({ view: true, add: true, edit: false, delete: false });
    });

    it('unions the parent permission with the node\'s own grant', async () => {
      await signIn(editorWith([permission({ nodeType: 'book', nodeId: 'book-1', delete: true })]));
      const parent: LibraryEffectivePermission = { view: true, add: false, edit: true, delete: false };
      expect(service.effectivePermission('book', 'book-1', parent))
        .toEqual({ view: true, add: false, edit: true, delete: true });
    });
  });

  describe('isVisible', () => {
    const NO_RIGHTS: LibraryEffectivePermission = { view: false, add: false, edit: false, delete: false };
    const CAN_VIEW: LibraryEffectivePermission = { view: true, add: false, edit: false, delete: false };

    it('shows everything to Admin', async () => {
      await signIn({ role: Role.ADMIN } as AdminUser);
      expect(service.isVisible('any-node', NO_RIGHTS)).toBeTrue();
    });

    it('shows a node the Editor really can view', async () => {
      await signIn(editorWith([]));
      expect(service.isVisible('series-1', CAN_VIEW)).toBeTrue();
    });

    it('hides a node with no rights and no granted descendant', async () => {
      await signIn(editorWith([]));
      expect(service.isVisible('series-9', NO_RIGHTS)).toBeFalse();
    });

    it('shows ancestors of a granted node so Browse stays navigable', async () => {
      // A grant on lesson-1 must reveal unit-1 -> book-1 -> series-1 without
      // conferring any rights on them.
      await signIn(editorWith([permission({ nodeType: 'lesson', nodeId: 'lesson-1', view: true })]));

      expect(service.ancestorVisibility()).toEqual(new Set(['unit-1', 'book-1', 'series-1']));
      expect(service.isVisible('unit-1', NO_RIGHTS)).toBeTrue();
      expect(service.isVisible('book-1', NO_RIGHTS)).toBeTrue();
      expect(service.isVisible('series-1', NO_RIGHTS)).toBeTrue();
      // ...but a sibling that is not on the path stays hidden.
      expect(service.isVisible('book-2', NO_RIGHTS)).toBeFalse();
    });
  });

  describe('ancestor visibility computation', () => {
    it('is empty for Admin (they see everything anyway) and when signed out', async () => {
      await signIn({ role: Role.ADMIN, libraryPermissions: [permission({ nodeType: 'lesson', nodeId: 'lesson-1', view: true })] } as AdminUser);
      expect(service.ancestorVisibility().size).toBe(0);
      expect(lessonLookups).toEqual([]); // no content reads at all

      await signIn(null);
      expect(service.ancestorVisibility().size).toBe(0);
    });

    it('ignores grants whose flags are all false', async () => {
      await signIn(editorWith([permission({ nodeType: 'lesson', nodeId: 'lesson-1' })]));
      expect(service.ancestorVisibility().size).toBe(0);
      expect(lessonLookups).toEqual([]);
    });

    it('stops walking when an ancestor cannot be resolved', async () => {
      await signIn(editorWith([permission({ nodeType: 'lesson', nodeId: 'lesson-orphan', add: true })]));
      // The missing unit is still recorded (it is the lesson's own parent id),
      // but the walk cannot continue past it.
      expect(service.ancestorVisibility()).toEqual(new Set(['unit-missing']));
    });

    it('is recomputed when a different user signs in', async () => {
      await signIn(editorWith([permission({ nodeType: 'lesson', nodeId: 'lesson-1', view: true })]));
      expect(service.ancestorVisibility().size).toBe(3);

      await signIn(editorWith([]));
      expect(service.ancestorVisibility().size).toBe(0);
    });
  });

  describe('resolveEffectivePermission', () => {
    it('returns everything for Admin without touching content services', async () => {
      await signIn({ role: Role.ADMIN } as AdminUser);
      await expectAsync(service.resolveEffectivePermission('lesson', 'lesson-1'))
        .toBeResolvedTo({ view: true, add: true, edit: true, delete: true });
      expect(lessonLookups).toEqual([]);
    });

    it('threads a series-level grant all the way down to a lesson', async () => {
      await signIn(editorWith([permission({ nodeType: 'series', nodeId: 'series-1', edit: true })]));
      const real = await service.resolveEffectivePermission('lesson', 'lesson-1');

      expect(real.edit).toBeTrue();
      expect(real.view).toBeTrue();
      expect(real.add).toBeFalse();
      expect(real.delete).toBeFalse();
    });

    it('gives nothing on a lesson under a series the Editor was not granted', async () => {
      await signIn(editorWith([permission({ nodeType: 'series', nodeId: 'other-series', edit: true })]));
      const real = await service.resolveEffectivePermission('lesson', 'lesson-1');
      expect(real).toEqual({ view: false, add: false, edit: false, delete: false });
    });

    it('honours a grant made directly on the lesson itself', async () => {
      await signIn(editorWith([permission({ nodeType: 'lesson', nodeId: 'lesson-1', delete: true })]));
      const real = await service.resolveEffectivePermission('lesson', 'lesson-1');
      expect(real.delete).toBeTrue();
      expect(real.view).toBeTrue();
    });

    it('falls back to the node alone when its chain cannot be resolved', async () => {
      await signIn(editorWith([permission({ nodeType: 'lesson', nodeId: 'lesson-missing', edit: true })]));
      const real = await service.resolveEffectivePermission('lesson', 'lesson-missing');
      expect(real.edit).toBeTrue();
    });
  });
});
