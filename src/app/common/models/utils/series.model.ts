import { BaseModel } from "../base.model"

export class SeriesModel extends BaseModel {
  order?: number;
  name?: string;
  imageUrl?: any;
  showInStore?: boolean;
}
