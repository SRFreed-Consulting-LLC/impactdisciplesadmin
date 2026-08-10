import { UNIT_OF_MEASURE } from "src/app/common/lists/unit_of_measure.enum";
import { BaseModel } from "../base.model"
import { TagModel } from "../domain/tag.model";
import { ImageModel } from "./image.model";

export class ProductModel extends BaseModel {
  isActive = false;
  imageUrl: ImageModel;
  title: string;
  cost = 0;
  salePrice = 0;
  description: string;
  series?: string;
  tags?: TagModel[];
  category: string;
  weight?: number;
  uom?: UNIT_OF_MEASURE;
  isEBook = false;
  isDigitalBook = false;
  digitalBookId: string;
  eBookUrl: ImageModel;
  seriesOrder: number;
  categoryOrder: number;
  sizes?: string[] = [];
  colors?: string[] = [];
  languages?: string[] = [];
  showInStore: boolean;
  sendFollowUpEmail: boolean;
  followUpEmailId: string;
}
