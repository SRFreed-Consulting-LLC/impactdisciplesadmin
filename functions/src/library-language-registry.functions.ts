import {triggerPath} from "./common/shared/lists/tenancy";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {onCall} from "firebase-functions/v2/https";
import {Timestamp, getFirestore} from "firebase-admin/firestore";
import {requireAdminRole} from "./admin-users.functions";
import {
  RebuildLanguageRegistryResult,
} from "./common/shared/contract/admin-callables.types";

// Sweep 2026-08-17: the reader's "which languages exist" discovery used to
// run getDocs(collectionGroup('translations')) - which forced the
// translations collection-group read open to any signed-in user, exposing
// the full text of every translated lesson (a paywall bypass). It only
// ever needed the DISTINCT locale codes, so we maintain a tiny registry
// doc instead: appConfig/availableLanguages = { locales: { code: label } }.
// The reader reads that one small doc; the translation docs themselves go
// back to being license-gated.

const db = getFirestore();
const REGISTRY_REF = "appConfig/availableLanguages";

/**
 * Folds one translation doc's locale into the registry.
 * @param {FirebaseFirestore.DocumentData | undefined} data Translation data.
 * @return {Promise<void>} Resolves when merged (or immediately if no locale).
 */
async function mergeLocale(
  data: FirebaseFirestore.DocumentData | undefined
): Promise<void> {
  const locale = typeof data?.locale === "string" ? data.locale : "";
  if (!locale) {
    return;
  }
  const label =
    typeof data?.localeLabel === "string" && data.localeLabel ?
      data.localeLabel :
      locale;
  await db.doc(REGISTRY_REF).set(
    {locales: {[locale]: label}, updatedAt: Timestamp.now()},
    {merge: true}
  );
}

// Keeps the registry current as translations are authored. Add-only by
// design: a locale is never removed here (dropping the last lesson in a
// language is rare, and a stale entry just offers an empty language, not a
// leak). rebuildLanguageRegistry (below) is the authoritative recompute.
export const onTranslationLocaleRegistry = onDocumentWritten(
  triggerPath("librarySeries",
    "{s}/books/{b}/units/{u}/lessons/{l}/translations/{t}"),
  async (event) => {
    const after = event.data?.after?.exists ?
      event.data.after.data() :
      undefined;
    await mergeLocale(after);
  }
);

/**
 * Authoritative recompute of the language registry from scratch - the
 * one-time backfill for translations that predate the trigger, and a
 * manual "fix it" if the add-only trigger ever drifts. Admin-only. Uses
 * the collection-group scan the reader no longer may (staff can).
 */
export const rebuildLanguageRegistry = onCall(async (request):
  Promise<RebuildLanguageRegistryResult> => {
  await requireAdminRole(request.auth?.uid);
  const snap = await db.collectionGroup("translations").get();
  const locales: Record<string, string> = {};
  snap.forEach((doc) => {
    const data = doc.data();
    const locale = typeof data.locale === "string" ? data.locale : "";
    if (locale && !locales[locale]) {
      locales[locale] =
        typeof data.localeLabel === "string" && data.localeLabel ?
          data.localeLabel :
          locale;
    }
  });
  await db.doc(REGISTRY_REF).set(
    {locales, updatedAt: Timestamp.now()},
    {merge: false}
  );
  return {locales, count: Object.keys(locales).length};
});
