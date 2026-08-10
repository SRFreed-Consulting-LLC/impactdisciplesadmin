import { OrganizationModel } from "./organization.model";
import { Person } from "./utils/person.model";
import { ImageModel } from "../utils/image.model";

export class CoachModel extends Person {
  isActive = false;
  sortOrder: number;
  teamPageSortOrder: number;
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
