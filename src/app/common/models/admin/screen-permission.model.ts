// Per-Employee granular access grant. Stored as an array field directly on
// the AdminUser document (admin_users/{id}) - modeled on
// impact-discipleship-library-manager-new's AppUser.permissions?:
// NodePermission[], adapted for a static Manager > Screen > Tab registry
// (nav-config.ts's NAV_CONFIG) instead of that app's dynamic library content
// tree. See PermissionService for how these are read/interpreted.
//
// Irrelevant for Admin/Root - they always have full access (see
// PermissionService.isFullAccess()) and are never shown a permissions table
// to configure. Only meaningful when role === Role.EMPLOYEE.
export interface ScreenPermission {
  // Dot-path into NAV_CONFIG, e.g. 'events-manager', 'events-manager.events',
  // or 'events-manager.events.attendees' - see PermissionService's own
  // comment on key construction.
  screenKey: string;
  view: boolean;
  add: boolean;
  edit: boolean;
  delete: boolean;
}

// The resolved, usable permission for one key - not persisted, computed by
// PermissionService.effectivePermission() by folding a real grant (or full
// access for Admin/Root) into one shape every call site checks the same way.
export interface EffectivePermission {
  view: boolean;
  add: boolean;
  edit: boolean;
  delete: boolean;
}
