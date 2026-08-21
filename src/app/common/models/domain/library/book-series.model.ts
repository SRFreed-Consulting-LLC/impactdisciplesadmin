import { BaseModel } from '@impact-common/shared/models/base.model';

// Mirrors the shared submodule's BookSeries shape
// (src/common/src/models/library.models.ts) field-for-field - the reader app
// and this app read/write the same series collection in the shared (default)
// database, so this must stay in sync with that model, not drift into its own
// shape. (The older, unrelated UnitModel/LessonModel shapes that once lived in
// common/models/domain/ were removed in the 2026-08-20 sweep; BookModel is
// still live only for the Products screen's book-id dropdown - see
// book.service.ts's own comment.)

export class BookSeriesModel extends BaseModel {
  title: string;
  description?: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}
