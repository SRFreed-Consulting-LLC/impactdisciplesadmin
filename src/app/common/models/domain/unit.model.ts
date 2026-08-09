import { BaseModel } from '../base.model';
import { LessonModel } from './lesson.model';

export class UnitModel extends BaseModel {
  title: string;
  order?: number;
  book?: string
  lessons?: LessonModel[]
}
