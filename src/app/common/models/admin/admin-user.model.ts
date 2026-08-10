import { Role } from "../../lists/roles.enum";
import { OrganizationModel } from "../domain/organization.model";
import { Person } from "../domain/utils/person.model";
import { ScreenPermission } from "./screen-permission.model";

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

    // Appearance preferences, set from the Settings page (see ThemeService) -
    // persisted per-admin so they follow this person across devices/sessions,
    // same idea as impact-discipleship-library-manager-new's per-user theme
    // fields, simplified to a single light/dark flag + one accent id (that
    // app keeps independent light/dark accent choices via a larger palette
    // catalog - out of scope here, see ThemeService's own comment).
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
