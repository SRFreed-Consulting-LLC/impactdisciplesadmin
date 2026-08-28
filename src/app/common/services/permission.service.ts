import { Injectable } from '@angular/core';
import { AdminAuthService } from '../forms/admin/admin-auth.service';
import { hasRole, Role } from '@impact-common/shared/lists/roles.enum';
import { NAV_CONFIG, NavGroup, NavLeaf } from '../../core/main-screen/nav-config';
import { AdminUser } from '../models/admin/admin-user.model';
import { EffectivePermission, ScreenPermission } from '../models/admin/screen-permission.model';

const ALL: EffectivePermission = { view: true, add: true, edit: true, delete: true };
const NONE: EffectivePermission = { view: false, add: false, edit: false, delete: false };

// One row of the permissions-editing table (admin-users.component.html's
// Permissions tab) - a flat, pre-indented walk of NAV_CONFIG built by
// buildPermissionTree(). Manager rows (depth 0), their Screen children
// (depth 1), and - Events only, today - Tab grandchildren (depth 2).
export interface PermissionNode {
  key: string;
  label: string;
  depth: 0 | 1 | 2;
}

// The one place in the app that answers "can the signed-in user view/add/
// edit/delete on this screen or tab" - every nav-filtering and list-screen
// gate in the app goes through this instead of re-deriving role checks
// locally. Modeled on impact-discipleship-library-manager-new's own
// PermissionService (NodePermission grants + effectivePermission() +
// ancestorVisibility split), adapted for this app's static Manager > Screen
// > Tab registry (NAV_CONFIG) instead of that app's dynamic Firestore
// content tree - see nav-config.ts's own comment on how the tree doubles as
// the permission registry.
//
// Permission keys are dot-paths built from NAV_CONFIG's own ids/slugs/tab
// keys: a manager is `group.id` (e.g. 'events-manager'), a screen is
// `${group.id}.${item.slug}` (e.g. 'events-manager.events'), a tab is
// `${group.id}.${item.slug}.${tab.key}` (e.g.
// 'events-manager.events.attendees'). Every call site in the app builds
// these the same mechanical way rather than hardcoding literal strings,
// except where a component already has its own group/item objects in hand.
//
// THESE GRANTS ARE ADVISORY. THEY ARE NOT A SECURITY BOUNDARY.
// Everything this service answers shapes the UI only: nav filtering,
// button visibility, and same-object re-checks inside a screen.
// firestore.rules cannot see a ScreenPermission at all - a grant lives in
// an admin_users doc, and rules can only read the four-tier `role` custom
// claim - so an Employee with NO grants whatsoever can still write
// anything the Employee tier is allowed to write, straight from devtools,
// no matter what this service returns. Confirmed and accepted 2026-08-28
// (sweep finding S2): the role tiers are the real model.
//
// So: anything too dangerous for the whole Employee tier belongs at
// Admin/Root in firestore.rules, NOT behind a grant here. `coupons` write
// and `mail` create+update were moved there for exactly this reason
// (`mail` because writing to it IS sending - the Trigger Email extension
// dispatches whatever lands there). Denying a screen here does not stop
// the write; it only stops the button being drawn.
@Injectable({
  providedIn: 'root'
})
export class PermissionService {
  private currentUser: AdminUser | null = null;

  constructor(authService: AdminAuthService) {
    // Same live source main-screen.component.ts's own currentUser field
    // uses - re-derived from Firebase's live auth state on every emission,
    // not the forgeable "impact-disciples-user" cookie. Cached
    // synchronously here so canView()/canAdd()/etc can be called directly
    // from templates (*ngIf, [visible] predicates) without an async pipe at
    // every call site, matching how events.component.ts already caches
    // currentUserRole off the same observable for its own isVisible().
    authService.dao.loggedInUser$.subscribe((user) => {
      this.currentUser = user;
    });
  }

  // Admin and Root (via hasRole's own Root-inherits-Admin fallthrough)
  // always have full access everywhere - the granular grant system below
  // exists only to give individual Employees a subset of that.
  isFullAccess(): boolean {
    return hasRole(this.currentUser?.role, [Role.ADMIN]);
  }

  // Role.EDITOR (the former library manager app's staff) is hard-scoped to
  // the Library section - NOT full access (must stay false so
  // canManagePermissions/canManageAdminUsers/canManageLogs, all gated on
  // isFullAccess(), still deny Editors), and NOT just another Employee-style
  // grant (Editors never get ScreenPermission entries at all - see
  // roles.enum.ts's own comment on why this is a distinct role). Checked
  // explicitly in canView()/effectivePermission() before the Employee-grant
  // fallthrough, so this guarantee holds regardless of what an Employee-style
  // `permissions` array might ever contain on an Editor's own AdminUser doc.
  private isLibraryEditor(): boolean {
    return this.currentUser?.role === Role.EDITOR;
  }

  private isLibraryKey(key: string): boolean {
    return key === 'library-manager' || key.startsWith('library-manager.');
  }

  private grant(key: string): ScreenPermission | undefined {
    return this.currentUser?.permissions?.find((p) => p.screenKey === key);
  }

  // The real, usable permission for exactly this key - does NOT include
  // ancestor-inherited view (see canView() for that). `view` is true if
  // ANY of view/add/edit/delete was granted, matching the sibling app's own
  // effectivePermission() - granting add/edit/delete without view doesn't
  // make sense (you can't add to a list you can't see), so view is implied.
  effectivePermission(key: string): EffectivePermission {
    if (this.isFullAccess()) {
      return ALL;
    }
    if (this.isLibraryEditor()) {
      // View-only here, unconditionally, until Library's own per-content-
      // node grant system (LibraryPermissionService, a later slice) exists
      // to actually decide add/edit/delete - avoids this generic service
      // silently implying edit rights on Library screens it doesn't govern
      // the specifics of. Screens needing finer control read that service
      // instead, once it exists; this only ever answers "can an Editor see
      // the Library section's own nav/shell at all".
      return this.isLibraryKey(key) ? { view: true, add: false, edit: false, delete: false } : NONE;
    }
    const g = this.grant(key);
    if (!g) {
      return NONE;
    }
    return {
      view: g.view || g.add || g.edit || g.delete,
      add: g.add,
      edit: g.edit,
      delete: g.delete
    };
  }

  // "If the user is given permission on a tab, the ancestor inherits" -
  // true either because this exact key has a real grant, or because some
  // descendant key (anything starting with `${key}.`) has any grant at
  // all. View only - add/edit/delete deliberately never inherit upward, so
  // an Employee granted only Events > Attendees can navigate Events
  // Manager -> Events -> (open an event) -> Attendees without gaining any
  // rights over the Events list itself or its other tabs. A cheap
  // string-prefix check, not an async walk, since the registry is a small
  // static tree (NAV_CONFIG) rather than the sibling app's dynamic
  // Firestore content tree.
  //
  // `employeeGrantable` defaults true (every normal screen); pass `false`
  // (NavLeaf.employeeGrantable) for a hard block that no grant, direct or
  // inherited, can ever override - see nav-config.ts's Admin Users entry.
  canView(key: string, employeeGrantable = true): boolean {
    if (this.isFullAccess()) {
      return true;
    }
    if (this.isLibraryEditor()) {
      // Hard block on every non-Library key, unconditionally - see this
      // class's isLibraryEditor() comment. Every Library NavLeaf also sets
      // employeeGrantable: false (nav-config.ts) so buildPermissionTree()
      // never offers Library screens as grantable to an Employee either -
      // this check is the other half, for Editors reaching a Library key.
      return this.isLibraryKey(key);
    }
    if (!employeeGrantable) {
      return false;
    }
    if (this.effectivePermission(key).view) {
      return true;
    }
    return (this.currentUser?.permissions ?? []).some(
      (p) => p.screenKey.startsWith(key + '.') && (p.view || p.add || p.edit || p.delete)
    );
  }

  canAdd(key: string): boolean {
    return this.effectivePermission(key).add;
  }

  canEdit(key: string): boolean {
    return this.effectivePermission(key).edit;
  }

  canDelete(key: string): boolean {
    return this.effectivePermission(key).delete;
  }

  // Nav/tab-switcher call sites all reduce to this - a NavLeaf's own key,
  // gated by its own employeeGrantable flag. Full access still short-
  // circuits inside canView() itself.
  canViewNavItem(group: NavGroup, item: NavLeaf): boolean {
    return this.canView(`${group.id}.${item.slug}`, item.employeeGrantable ?? true);
  }

  // Walks NAV_CONFIG once into the flat, pre-indented row list the
  // Permissions tab's <table> renders directly (admin-users.component.html)
  // - Manager rows, their Screen children, and (Events only) Tab
  // grandchildren. Skips Home (not a manager, nothing to grant) and any
  // employeeGrantable: false leaf (Admin Users) - those never appear in the
  // editing UI at all, matching how canView() hard-blocks them regardless
  // of what a grant might say.
  buildPermissionTree(): PermissionNode[] {
    const nodes: PermissionNode[] = [];

    for (const group of NAV_CONFIG) {
      if (!group.items) {
        continue; // Home - flat link, not a manager, nothing to grant.
      }

      const grantableItems = group.items.filter((item) => item.employeeGrantable !== false);
      if (grantableItems.length === 0) {
        continue;
      }

      nodes.push({ key: group.id, label: group.label, depth: 0 });

      for (const item of grantableItems) {
        const screenKey = `${group.id}.${item.slug}`;
        nodes.push({ key: screenKey, label: item.label, depth: 1 });

        for (const tab of item.tabs ?? []) {
          nodes.push({ key: `${screenKey}.${tab.key}`, label: tab.label, depth: 2 });
        }
      }
    }

    return nodes;
  }
}
