import {
  Transaction,
  DocumentReference,
  DocumentSnapshot,
} from "firebase-admin/firestore";

export interface ApplyLicenseGrantParams {
  transaction: Transaction;
  licenseRef: DocumentReference;
  recipientRef: DocumentReference;
  recipientSnap: DocumentSnapshot;
  bookId: string;
  licenseId: string;
  groupId: string;
  recipientEmail: string;
  now: number;
}

/**
 * Ported verbatim from impact-discipleship-library-manager-new's
 * group-license-grant.ts. Hands one GroupLicense unit to a recipient
 * inside an already-open transaction - the write into the recipient's OWN
 * `libraryUsers/{email}` doc is exactly what firestore.rules blocks from
 * any client, including the leader's, so this always runs server-side.
 * Shared by assignGroupLicense (leader-initiated) and acceptGroupInvite
 * (invite-acceptance-initiated) so the bookLicenses/licensedBookIds merge
 * logic lives in exactly one place. Deliberately never writes `userId` on
 * the recipient's doc - that field must only ever reflect the RECIPIENT's
 * own Auth uid, never whoever triggered the grant.
 * @param {ApplyLicenseGrantParams} params Transaction, license, recipient.
 * @return {void}
 */
export function applyLicenseGrant(params: ApplyLicenseGrantParams): void {
  const {
    transaction,
    licenseRef,
    recipientRef,
    recipientSnap,
    bookId,
    licenseId,
    groupId,
    recipientEmail,
    now,
  } = params;

  const existing = recipientSnap.exists ?
    (recipientSnap.data() as {
        bookLicenses?: Record<string, unknown>[];
        licensedBookIds?: string[];
      }) :
    undefined;
  const bookLicenses = (existing?.bookLicenses ?? []).filter(
    (l) => l["bookId"] !== bookId
  );
  bookLicenses.push({
    bookId,
    purchaseDate: now,
    source: "group-license",
    groupLicenseId: licenseId,
  });
  const licensedBookIds = Array.from(
    new Set([...(existing?.licensedBookIds ?? []), bookId])
  );

  transaction.set(
    recipientRef,
    {
      email: recipientEmail,
      bookLicenses,
      licensedBookIds,
      updatedAt: now,
      ...(existing ? {} : {createdAt: now}),
    },
    {merge: true}
  );

  transaction.update(licenseRef, {
    status: "assigned",
    assignedGroupId: groupId,
    assignedToEmail: recipientEmail,
    assignedAt: now,
  });
}
