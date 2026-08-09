import { BaseModel } from "../base.model";

export class FAQModel extends BaseModel{
  sortOrder: number;
  question?: string;
  answer?: string;
}
