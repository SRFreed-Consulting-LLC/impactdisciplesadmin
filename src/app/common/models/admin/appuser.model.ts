import { Role } from "../../lists/roles.enum";
import { OrganizationModel } from "../domain/organization.model";
import { Person } from "../domain/utils/person.model";

export class AppUser extends Person {
    email: string;
    firebaseUID: string;
    company: OrganizationModel;
    role: Role;

    constructor(){
      super();
    }


}
