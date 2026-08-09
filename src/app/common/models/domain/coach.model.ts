import { OrganizationModel } from "./organization.model";
import { Person } from "./utils/person.model";

export class CoachModel extends Person {
  isActive: boolean = false;
  sortOrder: number;
  teamPageSortOrder: number;
  fullname: string;
  title: string;
  photoUrl: any;
  bio: string
  organization: OrganizationModel | any;
  url: string;

  constructor(){
    super();

    this.fullname = this.firstName + ' ' + this.lastName;
  }
}
