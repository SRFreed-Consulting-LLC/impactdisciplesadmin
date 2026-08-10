import { BaseModel } from "../base.model";
import { OrganizationModel } from "./organization.model";
import { TrainingRoomModel } from "./training-room.model";
import { Address } from "./utils/address.model";
import { Phone } from "./utils/phone.model";

export class LocationModel extends BaseModel {
  name: string;
  address: Address;
  contactName: string;
  phone: Phone;
  trainingrooms: TrainingRoomModel[];
  // Either a full OrganizationModel (freshly picked in the form) or just its
  // id (as loaded from Firestore) - see organizationName()'s typeof check in
  // locations.component.ts.
  organization: OrganizationModel | string;
}
