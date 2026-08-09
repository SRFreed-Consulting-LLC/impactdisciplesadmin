import { BaseModel } from "../base.model";

export class TrainingRoomModel extends BaseModel {
  locationId: string;
  name: string;
  capacity?: number;
}
