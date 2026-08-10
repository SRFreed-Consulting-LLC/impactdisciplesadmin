export enum Role     {
    CUSTOMER = 'Customer',
    EMPLOYEE = 'Employee',
    ADMIN = 'Admin',
    // Above Admin - for now, a single manually-assigned account
    // (shane.freed@gmail.com) with every permission Admin has. Not in
    // AdminUserDialogComponent's assignable `roles` list on purpose - it's
    // not meant to be self-serve creatable from the UI yet. See hasRole()
    // below for how it inherits Admin's access.
    ROOT = 'Root'
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
