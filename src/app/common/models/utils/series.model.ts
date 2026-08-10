import { BaseModel } from "../base.model"
import { ImageModel } from "./image.model";

export class SeriesModel extends BaseModel {
  order?: number;
  name?: string;
  imageUrl?: ImageModel;
  showInStore?: boolean;
}
