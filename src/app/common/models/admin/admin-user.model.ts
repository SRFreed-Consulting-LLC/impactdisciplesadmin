import { Role } from "../../lists/roles.enum";
import { OrganizationModel } from "../domain/organization.model";
import { Person } from "../domain/utils/person.model";

export class AdminUser extends Person {
    email: string;
    firebaseUID: string;
    company: OrganizationModel;
    role: Role;

    // Appearance preferences, set from the Settings page (see ThemeService) -
    // persisted per-admin so they follow this person across devices/sessions,
    // same idea as impact-discipleship-library-manager-new's per-user theme
    // fields, simplified to a single light/dark flag + one accent id (that
    // app keeps independent light/dark accent choices via a larger palette
    // catalog - out of scope here, see ThemeService's own comment).
    darkMode?: boolean;
    colorTheme?: string;

    constructor(){
      super();
    }


}
