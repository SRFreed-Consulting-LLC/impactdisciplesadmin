import {triggerPath} from "./common/shared/lists/tenancy";
import {onDocumentDeleted} from "firebase-functions/v2/firestore";
import {getFirestore} from "firebase-admin/firestore";

// Cleanup for the top-level collections that REFERENCE a discussion group
// but do not live underneath it.
//
// Admin's deleteGroup cascade walks only what sits under the group document
// - members, chatMessages, prayerRequests, conversations/{email}/messages.
// `groupInvites` and `groupLicenses` are top-level and merely carry the
// group id in a FIELD, so nothing was ever cleaning them up. Both are
// top-level deliberately (an invite must be readable by an unauthenticated
// invitee without reading the parent group; a license belongs to the
// LEADER, scoped only by bookId, so an unassigned unit is a reserve
// reusable across groups) - so the answer is a cascade, not a re-modelling.
//
// A trigger rather than an addition to the admin app's own cascade, for two
// reasons: firestore.rules blocks ALL client writes to groupInvites
// (`allow write: if false`), so the admin app physically cannot do it; and a
// trigger also covers every other delete path - a script, a console delete,
// or any future caller - instead of just the one screen.

let dbInstance: FirebaseFirestore.Firestore | undefined;
const db = () => (dbInstance ??= getFirestore());

/**
 * Which of a deleted group's invites should be removed, and which are kept
 * as history. Pure so the policy is testable without Firestore.
 *
 * Only PENDING invites are deleted: the invite doc's own id is the bearer
 * token in the emailed link, so a pending invite for a group that no longer
 * exists is a live link to nothing. Accepted and declined invites are
 * immutable history and carry a denormalized groupTitle, so they still
 * render correctly in a leader's sent-invites list after the group is gone.
 * @param {string} status The invite's status field.
 * @return {boolean} True when the invite should be deleted.
 */
export function shouldDeleteInviteOnGroupDelete(status: unknown): boolean {
  return status === "pending";
}

/**
 * What happens to a license that was assigned through a now-deleted group.
 *
 * Deliberately NOT an automatic revoke. Revoking strips the book from the
 * recipient's libraryUsers grant, and staff deleting a group is moderation,
 * not the recipient's doing - silently taking away a book someone is
 * reading would be worse than the stale pointer. Instead the assignment is
 * marked detached, which is what lets revokeGroupLicense allow the leader to
 * reclaim the unit later as a deliberate act (see its missing-group branch).
 * @param {FirebaseFirestore.DocumentData} license The license doc data.
 * @return {boolean} True when it needs the detached marker.
 */
export function shouldDetachLicense(
  license: FirebaseFirestore.DocumentData
): boolean {
  return license.status === "assigned" && !!license.assignedGroupId;
}

export const onGroupDeletedCleanup = onDocumentDeleted(
  triggerPath("discussionGroups", "{groupId}"),
  async (event) => {
    const groupId = event.params.groupId;

    // Pending invites: hard delete, exactly what cancelGroupInvite does.
    const invites = await db()
      .collection("groupInvites")
      .where("groupId", "==", groupId)
      .get();
    const doomed = invites.docs.filter((d) =>
      shouldDeleteInviteOnGroupDelete(d.data().status));

    // Assigned licenses: mark, don't revoke - see shouldDetachLicense.
    const licenses = await db()
      .collection("groupLicenses")
      .where("assignedGroupId", "==", groupId)
      .get();
    const detachable = licenses.docs.filter((d) =>
      shouldDetachLicense(d.data()));

    if (!doomed.length && !detachable.length) {
      return;
    }

    const batch = db().batch();
    for (const doc of doomed) {
      batch.delete(doc.ref);
    }
    for (const doc of detachable) {
      batch.update(doc.ref, {assignedGroupDeleted: true});
    }
    await batch.commit();

    console.log(
      `onGroupDeletedCleanup(${groupId}): deleted ${doomed.length} pending ` +
      `invite(s), flagged ${detachable.length} assigned license(s).`
    );
  }
);
