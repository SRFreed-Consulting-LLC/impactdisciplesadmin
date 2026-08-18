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
        new RegExp(escapeRegExp(legacy), "g"),
        value ?? def.defaultValue
      );
    }
  }
  return result;
}
