import { BaseModel } from '@impact-common/shared/models/base.model';
import { LibraryFormioSchema } from './library-lesson.model';

export type LibrarySubtemplateType = 'header' | 'footer' | 'layout';

// Mirrors impact-discipleship-library-manager-new's own Subtemplate shape -
// see book-series.model.ts's own comment on why this is a fresh model. Only
// what Slice 2's Lesson Editor needs (read) - create/save/delete land with
// the Subtemplate Editor's own later slice.
export class LibrarySubtemplateModel extends BaseModel {
  title: string;
  type: LibrarySubtemplateType;
  formSchema: LibraryFormioSchema | null;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}
