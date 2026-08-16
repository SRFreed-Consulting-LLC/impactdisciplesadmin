// Mirrors a subset of impact-discipleship-library-manager-new's own
// ActivityAction/ActivityLogEntry (src/app/core/models/library.models.ts) -
// content-edit audit trail (who created/edited/deleted which series/book/
// unit/lesson/template), NOT the same thing as this app's own error/
// diagnostic LoggerService ("log-messages" - see the consolidation plan's
// "Decided - logging"). Only the actions Slice 2 actually emits so far are
// included; expand this union as later slices (Subtemplates, Lesson
// Templates, node CRUD) start logging their own actions too, matching the
// source app's full list.
export type LibraryActivityAction =
  | 'node_created'
  | 'node_updated'
  | 'node_deleted'
  | 'template_created'
  | 'template_updated'
  | 'template_deleted'
  | 'translation_created'
  | 'translation_updated'
  | 'translation_deleted'
  | 'permission_changed';

export interface LibraryActivityLogEntry {
  id?: string;
  actorUid: string;
  actorName: string;
  action: LibraryActivityAction;
  targetName?: string | null;
  detail?: string | null;
  timestamp: number;
}
