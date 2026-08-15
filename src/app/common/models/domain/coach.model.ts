import { OrganizationModel } from "./organization.model";
import { Person } from "./utils/person.model";
import { ImageModel } from "../utils/image.model";

// Breakout-instructor-only since the Impact Team split (2026-08) - this
// collection used to also drive the public "My Team" page via
// teamPageSortOrder (now removed; see impact-team.service.ts's own header
// comment for the split and MIGRATION.md for the one-time move of anyone
// who had it set). `sortOrder` here is whatever ordering this app's own
// Coaches screen wants, unrelated to any public-facing order now.
export class CoachModel extends Person {
  isActive = false;
  sortOrder: number;
  fullname: string;
  title: string;
  photoUrl: ImageModel;
  bio: string
  // Either a full OrganizationModel (freshly picked in the form) or just its
  // id (as loaded from Firestore) - see organizationName()'s typeof check in
  // coaches.component.ts/locations.component.ts.
  organization: OrganizationModel | string;
  url: string;

  constructor(){
    super();

    this.fullname = this.firstName + ' ' + this.lastName;
  }
}
