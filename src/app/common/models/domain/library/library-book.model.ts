import { BaseModel } from '../../base.model';

export interface BookLanguage {
  id: string;
  language: string;
  abbreviation: string;
}

// Mirrors impact-discipleship-library-manager-new's own Book shape
// (src/common/src/models/library.models.ts) field-for-field - see
// book-series.model.ts's own comment on why this is a fresh model rather
// than the existing (stale, differently-shaped) BookModel in
// common/models/domain/book.model.ts. Named LibraryBookModel, not BookModel,
// specifically to avoid any import ambiguity with that existing class.
export class LibraryBookModel extends BaseModel {
  seriesId: string;
  title: string;
  description?: string;
  year?: string;
  author?: string;
  languages?: BookLanguage[];
  // Missing/undefined is treated as published (true) - see the shared
  // model's own doc comment on Book.published.
  published?: boolean;
  order: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}
