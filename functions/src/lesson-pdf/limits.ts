/**
 * The size ceiling on an emailed lesson PDF.
 *
 * The PDF is attached inline as base64 on the mail document, and that document
 * is a Firestore document - capped at 1MB for the WHOLE document, fields and
 * html body included. Base64 inflates bytes by a third, so the raw PDF has to
 * stay well under that.
 *
 * 700KB is a guard rail rather than a limit anyone should meet: real lessons
 * render at 11-15KB, and the largest in the library is nowhere near. If it ever
 * trips, the fix is to put the file in Cloud Storage and attach a signed URL -
 * which is what this used to do, and was dropped because signing needs
 * iam.serviceAccounts.signBlob, a permission the default runtime service
 * account does not hold.
 */
export const MAX_PDF_BYTES = 700 * 1024;

/**
 * Whether a rendered PDF is too large to attach.
 *
 * @param {number} bytes Size of the rendered PDF.
 * @return {boolean} True when it must be refused rather than emailed.
 */
export function exceedsAttachmentLimit(bytes: number): boolean {
  return bytes > MAX_PDF_BYTES;
}

/**
 * The size the mail document will actually carry, which is what the 1MB
 * Firestore limit applies to - useful for asserting the headroom is real
 * rather than assumed.
 *
 * @param {number} bytes Size of the rendered PDF.
 * @return {number} Encoded size in bytes.
 */
export function base64Size(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}
