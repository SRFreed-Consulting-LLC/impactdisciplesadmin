import { BaseModel } from "../base.model";

export class EmailList extends BaseModel{
  type: string;
  name: string;
  // Member type varies by `type` (customers, newsletter subscribers, prayer
  // team subscribers, ...) - see the various *-list-dialog.component.ts
  // call sites.
  list: unknown[] = [];
}
