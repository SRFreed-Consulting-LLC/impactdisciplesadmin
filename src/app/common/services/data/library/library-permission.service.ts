import { tenantPath } from '@impact-common/shared/lists/tenancy';
import { Injectable, signal } from '@angular/core';
import { Firestore, doc, runTransaction } from '@angular/fire/firestore';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { hasRole, Role } from '@impact-common/shared/lists/roles.enum';
import { AdminUser } from 'src/app/common/models/admin/admin-user.model';
import { LibraryNodePermission, LibraryNodeType } from 'src/app/common/models/domain/library/library-node-permission.model';
import { BookSeriesService } from './book-series.service';
import { LibraryBookService } from './library-book.service';
import { LibraryUnitService } from './library-unit.service';
import { LibraryLessonService } from './library-lesson.service';
import { LibraryActivityLogService } from './library-activity-log.service';

/** A node's own real, propagating permission - see the class doc for the
 *  distinction from ancestor visibility. */
export interface LibraryEffectivePermission {
  view: boolean;
  add: boolean;
  edit: boolean;
  delete: boolean;
}

const NONE: LibraryEffectivePermission = { view: false, add: false, edit: false, delete: false };
const ALL: LibraryEffectivePermission = { view: true, add: true, edit: true, delete: true };

/**
 * Client-only per-content-node permission system for Role.EDITOR, ported
 * from impact-discipleship-library-manager-new's own PermissionService (see
 * that file's own extensive doc comment for the full design rationale -
 * this is a line-for-line port of its algorithm). Admin/Root always have
 * full access everywhere (via `PermissionService.isFullAccess()`'s
 * equivalent here); an Editor has NONE anywhere except whatever's been
 * explicitly granted on a specific series/book/unit/lesson via the "Manage
 * Permissions" action on a Browse row.
 *
 * Two distinct concepts, both needed to get propagation right - identical
 * to the source service:
 *  - `effectivePermission()`/`resolveEffectivePermission()` - the REAL
 *    permission, propagating DOWN (a grant on a Series flows to every
 *    Book/Unit/Lesson under it).
 *  - `ancestorVisibility()`/`isVisible()` - a node that's merely an
 *    ancestor of some OTHER node the user has a real grant on must still
 *    render (so Browse stays navigable down to that descendant), without
 *    conferring any real rights of its own or cascading to siblings.
 *
 * Grants live on the signed-in user's OWN admin_users document
 * (`AdminUser.libraryPermissions`) - this app's own staff table, in its
 * default database, per the consolidation plan's explicit decision (NOT the
 * named impactdiscipleship-books database the content itself lives in).
 */
@Injectable({
  providedIn: 'root'
})
export class LibraryPermissionService {
  // Plain field, not a signal - re-derived synchronously on every call to
  // isFullAccess()/effectivePermission() below instead, same pattern as
  // PermissionService.isFullAccess() (screen-permission gating) already
  // uses. Cheap enough not to matter, and avoids the trap of wrapping a
  // mutated-outside-Angular field in computed(), which would never actually
  // recompute (computed() only tracks SIGNAL reads for its dependency
  // graph, not a plain field mutated from a subscription callback).
  private currentUser: AdminUser | null = null;

  /** Node ids that must render purely because a descendant of theirs carries
   *  a real explicit grant. Empty for Admin/Root, who don't need it. */
  readonly ancestorVisibility = signal<ReadonlySet<string>>(new Set());

  constructor(
    private readonly firestore: Firestore,
    private readonly authService: AdminAuthService,
    private readonly activityLog: LibraryActivityLogService,
    private readonly seriesService: BookSeriesService,
    private readonly bookService: LibraryBookService,
    private readonly unitService: LibraryUnitService,
    private readonly lessonService: LibraryLessonService
  ) {
    this.authService.dao.loggedInUser$.subscribe((user) => {
      this.currentUser = user;
      if (!user || hasRole(user.role, [Role.ADMIN])) {
        this.ancestorVisibility.set(new Set());
        return;
      }
      void this.computeAncestorVisibility(user.libraryPermissions ?? []);
    });
  }

  isFullAccess(): boolean {
    return hasRole(this.currentUser?.role, [Role.ADMIN]);
  }

  /** The real, propagating permission for a node - pass the parent's own
   *  LibraryEffectivePermission (NONE for a root node, e.g. a series) so a
   *  grant higher up flows down automatically. Having any of add/edit/
   *  delete explicitly granted implies view too. */
  effectivePermission(
    nodeType: LibraryNodeType,
    nodeId: string,
    parent: LibraryEffectivePermission = NONE
  ): LibraryEffectivePermission {
    if (this.isFullAccess()) {
      return ALL;
    }
    const grant = this.currentUser?.libraryPermissions?.find(
      (p) => p.nodeType === nodeType && p.nodeId === nodeId
    );
    return {
      view: parent.view || !!grant?.view || !!grant?.add || !!grant?.edit || !!grant?.delete,
      add: parent.add || !!grant?.add,
      edit: parent.edit || !!grant?.edit,
      delete: parent.delete || !!grant?.delete,
    };
  }

  /** Whether a node should render in Browse at all: either it carries real
   *  view rights itself, or it's on the path down to a descendant that does. */
  isVisible(nodeId: string, real: LibraryEffectivePermission): boolean {
    return this.isFullAccess() || real.view || this.ancestorVisibility().has(nodeId);
  }

  private async computeAncestorVisibility(grants: LibraryNodePermission[]): Promise<void> {
    const relevant = grants.filter((g) => g.view || g.add || g.edit || g.delete);
    const ids = new Set<string>();
    await Promise.all(relevant.map((g) => this.collectAncestors(g.nodeType, g.nodeId, ids)));
    this.ancestorVisibility.set(ids);
  }

  /** Walks strictly upward from (not including) the given node, adding
   *  every ancestor's id along the way. */
  private async collectAncestors(nodeType: LibraryNodeType, nodeId: string, into: Set<string>): Promise<void> {
    if (nodeType === 'lesson') {
      const lesson = await this.lessonService.getById(nodeId);
      if (!lesson) return;
      into.add(lesson.unitId);
      await this.collectAncestors('unit', lesson.unitId, into);
    } else if (nodeType === 'unit') {
      const unit = await this.unitService.getById(nodeId);
      if (!unit) return;
      into.add(unit.bookId);
      await this.collectAncestors('book', unit.bookId, into);
    } else if (nodeType === 'book') {
      const book = await this.bookService.getById(nodeId);
      if (!book) return;
      into.add(book.seriesId);
    }
    // 'series' is the root - nothing further up.
  }

  /** A node's own LibraryEffectivePermission, computed from scratch by
   *  walking its ancestor chain root-first and threading
   *  effectivePermission() down through each level - for a screen (Lesson
   *  Editor, Subtemplate Editor, ...) reached directly via a route param,
   *  with no expansion history from Browse to build on. */
  async resolveEffectivePermission(nodeType: LibraryNodeType, nodeId: string): Promise<LibraryEffectivePermission> {
    if (this.isFullAccess()) {
      return ALL;
    }
    const chain = await this.resolveAncestorChain(nodeType, nodeId);
    return chain.reduce((parent, node) => this.effectivePermission(node.type, node.id, parent), NONE);
  }

  /** Root-first list of (type, id) from the series down to and including
   *  the given node. */
  private async resolveAncestorChain(
    nodeType: LibraryNodeType,
    nodeId: string
  ): Promise<{ type: LibraryNodeType; id: string }[]> {
    if (nodeType === 'lesson') {
      const lesson = await this.lessonService.getById(nodeId);
      if (!lesson) return [{ type: nodeType, id: nodeId }];
      return [...(await this.resolveAncestorChain('unit', lesson.unitId)), { type: nodeType, id: nodeId }];
    } else if (nodeType === 'unit') {
      const unit = await this.unitService.getById(nodeId);
      if (!unit) return [{ type: nodeType, id: nodeId }];
      return [...(await this.resolveAncestorChain('book', unit.bookId)), { type: nodeType, id: nodeId }];
    } else if (nodeType === 'book') {
      const book = await this.bookService.getById(nodeId);
      if (!book) return [{ type: nodeType, id: nodeId }];
      return [...(await this.resolveAncestorChain('series', book.seriesId)), { type: nodeType, id: nodeId }];
    }
    return [{ type: nodeType, id: nodeId }];
  }

  /**
   * Admin-only write. Reads-then-writes the target user's full
   * `libraryPermissions` array (Firestore has no atomic "upsert by matching
   * key" array operation) inside a transaction, so two admins editing the
   * same user's grants around the same time can't silently lose one of
   * their changes. Drops the entry entirely once all four flags are false.
   * `docId` is the target's own `admin_users` document id (NOT their
   * Firebase Auth uid - this app's staff table isn't uid-keyed, unlike the
   * source app's `adminUsers`) - the caller already has this from whatever
   * user list it's rendering.
   */
  async setPermission(
    docId: string,
    nodeType: LibraryNodeType,
    nodeId: string,
    changes: Partial<Pick<LibraryNodePermission, 'view' | 'add' | 'edit' | 'delete'>>,
    context: { targetName: string; nodeTitle: string }
  ): Promise<void> {
    const ref = doc(this.firestore, tenantPath('admin_users'), docId);
    let updated!: LibraryNodePermission;

    await runTransaction(this.firestore, async (transaction) => {
      const snap = await transaction.get(ref);
      const existing = (snap.data()?.['libraryPermissions'] as LibraryNodePermission[] | undefined) ?? [];
      const index = existing.findIndex((p) => p.nodeType === nodeType && p.nodeId === nodeId);
      const current: LibraryNodePermission =
        index >= 0 ? existing[index] : { nodeType, nodeId, view: false, add: false, edit: false, delete: false };
      updated = { ...current, ...changes };

      let next: LibraryNodePermission[];
      if (!updated.view && !updated.add && !updated.edit && !updated.delete) {
        next = index >= 0 ? existing.filter((_, i) => i !== index) : existing;
      } else if (index >= 0) {
        next = existing.map((p, i) => (i === index ? updated : p));
      } else {
        next = [...existing, updated];
      }

      transaction.update(ref, { libraryPermissions: next, updatedAt: Date.now() });
    });

    const granted = (['view', 'add', 'edit', 'delete'] as const).filter((flag) => updated[flag]);
    const detail =
      granted.length > 0 ? `Set ${granted.join(', ')} on ${context.nodeTitle}` : `Removed all permissions on ${context.nodeTitle}`;
    await this.activityLog.log('permission_changed', { targetName: context.targetName, detail });
  }
}
