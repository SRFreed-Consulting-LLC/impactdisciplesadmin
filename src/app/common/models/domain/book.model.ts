import { BaseModel } from '../base.model';
import { UnitModel } from './unit.model';
import { LessonModel } from './lesson.model';
import { LanguageModel } from './language.model';

export class BookModel extends BaseModel {
  title: string;
  series?: string;
  author?: string;
  year?: number;
  units?: UnitModel[];
  lessons?: LessonModel[];
  order?: number;
  languages?: LanguageModel[] = []
}
