import { BaseModel } from '../base.model';

export class LessonModel extends BaseModel {
  title: string;
  form?: string;
  showDailyReading = false;
  book: string;
  unit?: string;
  order: number;
  memoryVerse?: string;
  goal?: string;
  monVerse?: string;
  tueVerse?: string;
  wedVerse?: string;
  thuVerse?: string;
  friVerse?: string;
  dailyReadingVerse?: string;
  questions?: string[];
}
