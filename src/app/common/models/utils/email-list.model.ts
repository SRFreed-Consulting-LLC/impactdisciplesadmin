import { BaseModel } from "../base.model";

export class EmailList extends BaseModel{
  type: string;
  name: string;
  list: any[] = [];
}
