import { BaseModel } from '../../base.model';

// Mirrors impact-discipleship-library-manager-new's own LessonTemplate shape
// - see book-series.model.ts's own comment on why this is a fresh model.
export class LibraryLessonTemplateModel extends BaseModel {
  title: string;
  headerSubtemplateId: string | null;
  layoutSubtemplateId: string | null;
  footerSubtemplateId: string | null;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}
