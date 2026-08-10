import { Timestamp } from "firebase/firestore";
import { BaseModel } from "../base.model";
import { TagModel } from "./tag.model";
import { ImageModel } from "../utils/image.model";

export class PodCastModel extends BaseModel{
  isActive = false;
  date: Timestamp | Date;
  title: string;
  category?: string;
  videoType: string;
  videoId: string;
  description: string;
  thumbnail: ImageModel | null;
  tags?: TagModel[];
}
