import { Timestamp } from "firebase/firestore";
import { BaseModel } from "../../base.model";

export class CustomerNoteModel extends BaseModel{
  date: Timestamp;
  addedBy: string;
  note: string;
  private: boolean;
}
