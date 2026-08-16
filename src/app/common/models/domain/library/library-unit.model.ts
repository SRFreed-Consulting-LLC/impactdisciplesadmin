import { BaseModel } from '../../base.model';

// Mirrors impact-discipleship-library-manager-new's own Unit shape - see
// book-series.model.ts's own comment on why this is a fresh model.
export class LibraryUnitModel extends BaseModel {
  bookId: string;
  title: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}
