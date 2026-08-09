import { BaseModel } from "../base.model";

export class TaxRateSummary extends BaseModel{
  zip: string;
  total: number;
  year: string
}
