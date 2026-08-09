import { BaseModel } from '../base.model';

export class CourseModel extends BaseModel {
  title: string;
  shortDescription: string;
  longDescription: string;
  resources: string;
  length: string;
}
