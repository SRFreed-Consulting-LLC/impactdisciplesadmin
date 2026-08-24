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
  | 'permission_changed'
  | 'config_tier_created'
  | 'config_tier_updated'
  | 'config_tier_deleted'
  | 'library_user_updated'
  | 'library_user_revoked'
  | 'library_user_reinstated'
  | 'library_user_license_granted'
  | 'library_user_license_revoked'
  | 'admin_message_sent'
  // Impact Groups. Staff can EDIT any group (including its book and its
  // visibility) and HARD-DELETE it along with every message, prayer request
  // and conversation underneath - the only destructive action in the
  // library area, and until 2026-08-24 it left no trace anywhere.
  | 'group_updated'
  | 'group_deleted';

export interface LibraryActivityLogEntry {
  id?: string;
  actorUid: string;
  actorName: string;
  action: LibraryActivityAction;
  targetName?: string | null;
  detail?: string | null;
  timestamp: number;
}

/** Display label for each LibraryActivityAction - shared by the Activity
 *  Log viewer's table/filter dropdown, same "one shared map" convention as
 *  the source app's own ACTIVITY_ACTION_LABELS. Only covers this app's own
 *  (narrower) action union - the source's user_created/user_updated/
 *  user_deleted/purchase_refunded/password_reset_sent actions belong to
 *  staff-provisioning/purchase systems this app deliberately did not port
 *  (see the consolidation plan's Slice 3 scope note), so nothing here ever
 *  writes those and they're not included. */
export const LIBRARY_ACTIVITY_ACTION_LABELS: Record<LibraryActivityAction, string> = {
  node_created: 'Created item',
  node_updated: 'Updated item',
  node_deleted: 'Deleted item',
  template_created: 'Created template',
  template_updated: 'Updated template',
  template_deleted: 'Deleted template',
  translation_created: 'Created translation',
  translation_updated: 'Updated translation',
  translation_deleted: 'Deleted translation',
  permission_changed: 'Changed permissions',
  config_tier_created: 'Created discount tier',
  config_tier_updated: 'Updated discount tier',
  config_tier_deleted: 'Deleted discount tier',
  library_user_updated: 'Updated library user',
  library_user_revoked: 'Revoked library user access',
  library_user_reinstated: 'Restored library user access',
  library_user_license_granted: 'Granted book license',
  library_user_license_revoked: 'Revoked book license',
  admin_message_sent: 'Sent message to library users',
  group_updated: 'Edited Impact Group',
  group_deleted: 'Deleted Impact Group',
};
