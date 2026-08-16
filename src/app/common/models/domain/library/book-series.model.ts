import { BaseModel } from '../../base.model';

// Mirrors impact-discipleship-library-manager-new's own BookSeries shape
// (src/common/src/models/library.models.ts) field-for-field - both apps
// read/write the same `series` collection in the shared named
// 'impactdiscipleship-books' database, so this must stay in sync with that
// shared submodule's model, not drift into its own shape. Deliberately NOT
// reusing this app's existing BookModel/UnitModel/LessonModel
// (common/models/domain/*.model.ts) - those are a stale shape ported from an
// older, unrelated project (impactdisciplespwacommon) that happens to share
// a table name; see book.service.ts's own comment on why it's still live
// (Products screen's book-id dropdown) despite not matching the real schema.
export class BookSeriesModel extends BaseModel {
  title: string;
  description?: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}
