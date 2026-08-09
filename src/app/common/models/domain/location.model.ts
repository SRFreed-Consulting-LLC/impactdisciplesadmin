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
  organization: OrganizationModel | any;
}
