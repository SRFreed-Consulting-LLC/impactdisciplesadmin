import { Role } from "../../lists/roles.enum";
import { OrganizationModel } from "../domain/organization.model";
import { Person } from "../domain/utils/person.model";
import { ScreenPermission } from "./screen-permission.model";
import { LibraryNodePermission } from "../domain/library/library-node-permission.model";

export class AdminUser extends Person {
    email: string;
    firebaseUID: string;
    company: OrganizationModel;
    role: Role;

    // Only meaningful when role === Role.EMPLOYEE - see PermissionService.
    // undefined means "not yet migrated" (a pre-existing Employee account
    // from before this system existed - see PermissionMigrationService),
    // [] means "deliberately zero grants" (a brand-new Employee, or an
    // existing one an Admin has revoked everything from).
    permissions?: ScreenPermission[];

    // Only meaningful when role === Role.EDITOR - the Library section's own
    // per-content-node grants (a specific series/book/unit/lesson), parallel
    // to `permissions` above but for a dynamic Firestore content tree
    // instead of the static NAV_CONFIG screen list - see
    // LibraryPermissionService for how these are read/interpreted. undefined
    // and [] both mean "no grants yet" here (there is no pre-existing-
    // account migration case to distinguish, unlike `permissions` - every
    // Editor account is created after this field already existed).
    libraryPermissions?: LibraryNodePermission[];

    // Appearance preferences, set from the Settings page (see ThemeService) -
    // persisted per-admin so they follow this person across devices/sessions,
    // same idea as impact-discipleship-library-manager-new's per-user theme
    // fields, simplified to a single light/dark flag + one accent id (that
    // app keeps independent light/dark accent choices via a larger palette
    // catalog - out of scope here, see ThemeService's own comment).
    /**
     * @deprecated Superseded by the 10-variant navy theme catalog (see
     * ThemeService) - each variant fixes its own light/dark character, so
     * there is no independent dark-mode toggle any more. Kept on the model
     * so existing Firestore docs round-trip untouched through the full-record
     * update() writes; never read or written by current code.
     */
    darkMode?: boolean;
    colorTheme?: string;

    // Left-nav "pin to top" shortcuts - dot-path screen keys (same scheme as
    // ScreenPermission.screenKey, e.g. 'events-manager.coaches'), in the
    // order the user pinned them. Persisted per-admin like the theme fields
    // above, not per-browser, so pins follow this person across devices. See
    // MainScreenComponent.togglePin()/rebuildPinnedItems().
    pinnedScreens?: string[];

    // Whether the left nav drawer stays open permanently vs. auto-collapses
    // to an icon rail when the mouse isn't over it. undefined (every
    // account that predates this feature) defaults to pinned/expanded -
    // see MainScreenComponent.isDrawerPinned - so nobody's nav silently
    // starts auto-collapsing on them.
    drawerPinned?: boolean;

    constructor(){
      super();
    }


}
