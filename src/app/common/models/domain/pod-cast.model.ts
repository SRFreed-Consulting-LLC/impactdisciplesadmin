import { Timestamp } from "firebase/firestore";
import { BaseModel } from "../base.model";
import { TagModel } from "./tag.model";

export class PodCastModel extends BaseModel{
  isActive: boolean = false;
  date: Timestamp | Date;
  title: string;
  category?: string;
  videoType: string;
  videoId: string;
  description: string;
  thumbnail: any | null;
  tags?: TagModel[];
}
