// Per-Editor, per-content-node grant - lets an Editor be given view/add/
// edit/delete on one specific series/book/unit/lesson, rather than the
// Library section being all-or-nothing. Stored directly on the granted
// user's own AdminUser document (admin_users/{id}.libraryPermissions), same
// pattern as ScreenPermission does for Employee grants - see that model's
// own comment. Modeled on impact-discipleship-library-manager-new's own
// NodePermission (core/models/library.models.ts) - see
// LibraryPermissionService for how these are read/interpreted (OR-merge to
// descendants, ancestor view-only for navigation).
//
// Client-side enforcement only, same as the source app's own model - there
// is no matching Firestore rules restriction (rules gate on isStaff(), not
// per-node). Not a security boundary, a UI convenience - see the source
// model's identical doc comment.
//
// LibraryNodeType itself is NOT redeclared here - it's the exact same type
// already imported from the shared submodule for translations
// (@impact-common/models/translation.models), reused rather than duplicated.
import { LibraryNodeType } from '@impact-common/models/translation.models';
export type { LibraryNodeType };

export interface LibraryNodePermission {
  nodeType: LibraryNodeType;
  nodeId: string;
  view: boolean;
  add: boolean;
  edit: boolean;
  delete: boolean;
}
