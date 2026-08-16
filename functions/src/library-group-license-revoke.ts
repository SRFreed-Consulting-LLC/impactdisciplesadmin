import {
  Transaction,
  DocumentReference,
  DocumentSnapshot,
  FieldValue,
} from "firebase-admin/firestore";

export interface ApplyLicenseRevokeParams {
  transaction: Transaction;
  licenseRef: DocumentReference;
  recipientRef: DocumentReference;
  recipientSnap: DocumentSnapshot;
  licenseId: string;
  bookId: string;
}

/**
 * Ported verbatim from impact-discipleship-library-manager-new's
 * group-license-revoke.ts. Takes back one previously-assigned GroupLicense
 * unit inside an already-open transaction - the inverse of
 * applyLicenseGrant, and shared for the same reason: the write into the
 * recipient's own `libraryUsers/{email}` doc is exactly what
 * firestore.rules blocks from any client. Shared by revokeGroupLicense
 * (leader-initiated) and leaveGroupAndRevokeLicense (self-initiated, on
 * leaving a still-open group). Removing the flat `licensedBookIds` entry
 * is skipped if the recipient also holds a separate, non-group-license
 * grant for the same book (tracked via `bookLicenses`), so revoking a
 * group-given license never takes back access they separately paid for
 * themselves.
 * @param {ApplyLicenseRevokeParams} params Transaction, license, recipient.
 * @return {void}
 */
export function applyLicenseRevoke(params: ApplyLicenseRevokeParams): void {
  const {
    transaction,
    licenseRef,
    recipientRef,
    recipientSnap,
    licenseId,
    bookId,
  } = params;

  if (recipientSnap.exists) {
    const data = recipientSnap.data() as {
      bookLicenses?: Record<string, unknown>[];
      licensedBookIds?: string[];
    };
    const bookLicenses = (data.bookLicenses ?? []).filter(
      (l) => l["groupLicenseId"] !== licenseId
    );
    const stillLicensed = bookLicenses.some((l) => l["bookId"] === bookId);
    const licensedBookIds = stillLicensed ?
      (data.licensedBookIds ?? []) :
      (data.licensedBookIds ?? []).filter((id) => id !== bookId);
    transaction.update(recipientRef, {
      bookLicenses,
      licensedBookIds,
      updatedAt: Date.now(),
    });
  }

  transaction.update(licenseRef, {
    status: "unassigned",
    assignedGroupId: FieldValue.delete(),
    assignedToEmail: FieldValue.delete(),
    assignedAt: FieldValue.delete(),
  });
}
