import { Timestamp } from 'firebase/firestore';
import { BaseModel } from '../base.model';
import { ImageModel } from '../utils/image.model';

export class HomePageImageModel extends BaseModel {
  isActive = false;
  order: number;
  image?: ImageModel;
  title: string;
  text?: string;
  ctaTitle?: string;
  ctaDestination?: string;
  ctaUrl?: string;
  date: Timestamp;
}
