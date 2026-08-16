// Ported verbatim from impact-discipleship-library-manager-new's
// core/services/hash.util.ts - cheap, deterministic, non-cryptographic
// (djb2), turning arbitrary text (including a full base64 image data URI)
// into a short, Firestore-doc-id-safe fragment so the same content always
// upserts the same document. Used for lessonImages ids.
export function libraryHashText(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}
