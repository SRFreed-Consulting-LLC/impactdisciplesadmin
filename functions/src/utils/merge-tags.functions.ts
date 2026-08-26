// Functions-side twin of the client's merge-tag engine
// (src/app/common/utils/email/merge-tags.ts) - keep the two in sync (the
// established manual-mirror pattern; the two npm projects share no
// modules). Same semantics: *|TAG|* Mailchimp-style tags including the
// *|TAG|fallback|* inline-default form, each tag also absorbing the legacy
// {{...}} spellings, and every occurrence replaced.

export interface MergeTagDef {
  tag: string;
  resolverKey: string;
  defaultValue: string;
  legacyTokens?: string[];
}

export type MergeContext = Record<string, string | undefined>;

export const MERGE_TAGS: MergeTagDef[] = [
  {
    tag: "FNAME",
    resolverKey: "firstName",
    defaultValue: "",
    legacyTokens: ["{{Recipient First Name}}", "{{firstName}}"],
  },
  {
    tag: "LNAME",
    resolverKey: "lastName",
    defaultValue: "",
    legacyTokens: ["{{Recipient Last Name}}", "{{lastName}}"],
  },
  {
    tag: "EMAIL",
    resolverKey: "email",
    defaultValue: "",
    legacyTokens: ["{{email}}"],
  },
  {
    tag: "DATE",
    resolverKey: "date",
    defaultValue: "",
    legacyTokens: ["{{Date}}"],
  },
  {
    tag: "SENDER_FNAME",
    resolverKey: "senderFirstName",
    defaultValue: "",
    legacyTokens: ["{{Sender First Name}}"],
  },
  {
    tag: "SENDER_LNAME",
    resolverKey: "senderLastName",
    defaultValue: "",
    legacyTokens: ["{{Sender Last Name}}"],
  },
  {
    tag: "TRACKING",
    resolverKey: "tracking",
    defaultValue: "",
    legacyTokens: ["{{tracking}}"],
  },
  {
    tag: "UNSUB",
    resolverKey: "unsubscribeUrl",
    defaultValue: "#",
  },
];

/**
 * Escapes a literal for use inside a RegExp.
 * @param {string} literal The literal string.
 * @return {string} The escaped pattern.
 */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches the single space in a legacy token against any spelling of a
 *  space the editor might have produced. Quill 2's getSemanticHTML() encodes
 *  EVERY space as `&nbsp;`, so a token inserted through the editor reaches
 *  this renderer as `{{Recipient&nbsp;First&nbsp;Name}}` - which an exact
 *  literal match misses, and the tag then renders verbatim in the email.
 *  (Live bug, found 2026-08-24 on a real send.)
 */
const LEGACY_SPACE = String.raw`(?:\s|&nbsp;|&#160;|&#xa0;)+`;

/**
 * A legacy `{{Some Token}}` as a pattern that tolerates &nbsp; between its
 * words. Single-word tokens are unaffected.
 * @param {string} literal The legacy token, e.g. "{{Recipient First Name}}".
 * @return {string} A RegExp source string.
 */
function legacyTokenPattern(literal) {
  return literal.split(" ").map(escapeRegExp).join(LEGACY_SPACE);
}

/**
 * Replaces every occurrence of every registered tag (plain,
 * inline-fallback, and legacy forms). Unknown tags pass through.
 * @param {string} html The email html.
 * @param {MergeContext} data Values keyed by resolverKey.
 * @return {string} The rendered html.
 */
export function renderMergeTags(html: string, data: MergeContext): string {
  let result = html ?? "";
  for (const def of MERGE_TAGS) {
    const value = data[def.resolverKey];
    const tag = escapeRegExp(def.tag);

    result = result.replace(
      new RegExp("\\*\\|" + tag + "\\|([^|*]*)\\|\\*", "g"),
      (_match, fallback: string) => value ?? fallback
    );
    result = result.replace(
      new RegExp("\\*\\|" + tag + "\\|\\*", "g"),
      value ?? def.defaultValue
    );
    for (const legacy of def.legacyTokens ?? []) {
      result = result.replace(
        new RegExp(legacyTokenPattern(legacy), "g"),
        value ?? def.defaultValue
      );
    }
  }
  return result;
}
