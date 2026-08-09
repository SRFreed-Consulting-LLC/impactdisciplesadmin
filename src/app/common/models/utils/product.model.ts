import { UNIT_OF_MEASURE } from "src/app/common/lists/unit_of_measure.enum";
import { BaseModel } from "../base.model"
import { TagModel } from "../domain/tag.model";

export class ProductModel extends BaseModel {
  isActive: boolean = false;
  imageUrl: any;
  title: string;
  cost: number = 0;
  salePrice: number = 0;
  description: string;
  series?: string;
  tags?: TagModel[];
  category: string;
  weight?: number;
  uom?: UNIT_OF_MEASURE;
  isEBook: boolean = false;
  isDigitalBook: boolean = false;
  digitalBookId: string;
  eBookUrl: any;
  seriesOrder: number;
  categoryOrder: number;
  sizes?: string[] = [];
  colors?: string[] = [];
  languages?: string[] = [];
  showInStore: boolean;
  sendFollowUpEmail: boolean;
  followUpEmailId: string;
}
