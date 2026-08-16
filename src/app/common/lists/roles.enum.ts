export enum Role     {
    CUSTOMER = 'Customer',
    EMPLOYEE = 'Employee',
    ADMIN = 'Admin',
    // Above Admin - for now, a single manually-assigned account
    // (shane.freed@gmail.com) with every permission Admin has. Not in
    // AdminUserDialogComponent's assignable `roles` list on purpose - it's
    // not meant to be self-serve creatable from the UI yet. See hasRole()
    // below for how it inherits Admin's access.
    ROOT = 'Root',
    // The former impact-discipleship-library-manager-new app's own staff,
    // ported over as this app absorbs its CMS (see that app's consolidation
    // plan). Hard-scoped in PermissionService.canView()/effectivePermission()
    // to the 'library-manager' NAV_CONFIG group and nothing else - an Editor
    // never sees Store/Events/Customers/etc, by construction (checked before
    // any ScreenPermission grant lookup), not via a grants convention an
    // Admin could misconfigure. Distinct from Employee on purpose: Employee
    // covers the other 8 "business" managers via per-screen grants, Editor
    // covers Library exclusively via its own per-content-node grant system
    // (series/book/unit/lesson - see LibraryPermissionService).
    EDITOR = 'Editor'
}

// Every role-gating check in this app ultimately reduces to "is the
// user's role included in this allow-list" - use this instead of a raw
// `allowedRoles.includes(userRole)`/`.some(role => role === userRole)`
// everywhere that comparison happens (nav-config.ts's group/item
// filtering, every isVisible(roles) method), so Root's "same permissions
// as Admin" only has to be encoded in one place. A future Admin-only
// check added anywhere in the app automatically covers Root too, with no
// separate Root entry needed at each call site.
export function hasRole(userRole: Role | string | undefined, allowedRoles: (Role | string)[]): boolean {
    if (!userRole) {
        return false;
    }
    if (allowedRoles.includes(userRole)) {
        return true;
    }
    return userRole === Role.ROOT && allowedRoles.includes(Role.ADMIN);
}
