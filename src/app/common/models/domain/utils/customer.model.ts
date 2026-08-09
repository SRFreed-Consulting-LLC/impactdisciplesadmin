import { Role } from "src/app/common/lists/roles.enum";
import { Person } from "./person.model";
import { CustomerNoteModel } from "./customer-note.model";

export class CustomerModel extends Person {
    email: string;
    firebaseUID: string;
    role: Role = Role.CUSTOMER;
    notes?: CustomerNoteModel[] = [];

    constructor(){
      super();
    }


}
