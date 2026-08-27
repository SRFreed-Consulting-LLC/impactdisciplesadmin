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
  // Per-process variables (2026-08-27). Always supplied by their send paths,
  // but only in the legacy {{...}} spelling and never registered - so the
  // builder's tag menu could not offer them. `legacyTokens` keeps every
  // template already written against {{eventName}} working unchanged.
  // Mirror of src/app/common/utils/email/merge-tags.ts - keep in step.
  {
    tag: "EVENT_NAME",
    resolverKey: "eventName",
    defaultValue: "",
    legacyTokens: ["{{eventName}}"],
  },
  {
    tag: "START_DATE",
    resolverKey: "startDate",
    defaultValue: "",
    legacyTokens: ["{{startDate}}"],
  },
  {
    tag: "EDIT_REGISTRATION",
    resolverKey: "editRegistration",
    defaultValue: "",
    legacyTokens: ["{{editRegistration}}"],
  },
  {
    tag: "ORDER_ITEMS",
    resolverKey: "product_list",
    defaultValue: "",
    legacyTokens: ["{{product_list}}"],
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

// --------------------------------------------------------------- one pass
//
// The transactional renderer: resolves BOTH tag syntaxes in a SINGLE scan of
// the template.
//
// It exists because neither of the two renderers before it could serve a
// transactional template that is editable in the email builder:
//
//   renderPlaceholders  understands {{arbitraryKey}} from the caller's model
//                       - {{eventName}}, {{startDate}}, {{editRegistration}}
//                       - but not *|FNAME|*, which the builder's tag menu is
//                       what writes. It mails those to the customer raw.
//   renderMergeTags     understands *|TAG|* against a fixed list, but has no
//                       idea what {{eventName}} is, so it mails THOSE raw.
//
// An event confirmation needs both at once, so the two had to become one.
//
// SINGLE PASS, and that is the whole point rather than an optimisation.
// renderPlaceholders' own comment records why: it replaced loops that walked
// the model key by key, so a value substituted early was rescanned by every
// later iteration, and someone registering as "{{editRegistration}}" got that
// link expanded into the name position of their own confirmation email.
// escapeHtml does not escape braces, pipes or asterisks, and these fields
// come straight off public endpoints. One .replace() over the TEMPLATE means
// substituted text is output and never input - for either syntax, which is
// strictly better than renderMergeTags, whose tag-by-tag loop still rescans.
//
// Resolution order for {{...}}: the caller's model first (so an explicit
// eventName always wins), then the legacy spellings registered on MERGE_TAGS
// (tolerating the &nbsp; Quill leaves between words). Unknown tags in either
// syntax are left EXACTLY as written - a literal *|SOMETHING|* in an email is
// a visible bug someone reports, where silently deleting it is not.

/** Normalises the inside of a `{{...}}` for legacy-token lookup: any run of
 *  whitespace or an encoded nbsp collapses to one plain space. */
function normalizeToken(inner: string): string {
  return inner.replace(/(?:\s|&nbsp;|&#160;|&#xa0;)+/g, " ").trim();
}

/** Legacy `{{Some Token}}` spelling (normalised, braces stripped) -> its tag
 *  definition. Built once; MERGE_TAGS is a module constant. */
const LEGACY_BY_TOKEN = new Map<string, MergeTagDef>();
for (const def of MERGE_TAGS) {
  for (const legacy of def.legacyTokens ?? []) {
    const inner = legacy.replace(/^\{\{|\}\}$/g, "");
    LEGACY_BY_TOKEN.set(normalizeToken(inner), def);
  }
}

const TAG_BY_NAME = new Map(MERGE_TAGS.map((def) => [def.tag, def]));

// *|TAG|*  |  *|TAG|inline fallback|*  |  {{anything}}
const COMBINED = new RegExp(
  "\\*\\|([A-Za-z_][A-Za-z0-9_]*)\\|(?:([^|*]*)\\|)?\\*" +
  "|\\{\\{([^{}]*)\\}\\}",
  "g"
);

/**
 * Renders a transactional email body, resolving *|TAG|* (with or without an
 * inline fallback) and {{key}} in one pass over the template.
 * @param {string} html The template body.
 * @param {MergeContext} model Values by resolverKey AND by arbitrary
 * caller-supplied key; callers escape anything user-supplied first.
 * @return {string} The rendered body.
 */
export function renderEmailBody(html: string, model: MergeContext): string {
  return (html ?? "").replace(
    COMBINED,
    (match, tagName: string, fallback: string, braceInner: string) => {
      if (tagName !== undefined) {
        const def = TAG_BY_NAME.get(tagName);
        if (!def) {
          return match;
        }
        const value = model[def.resolverKey];
        return value ?? (fallback !== undefined ? fallback : def.defaultValue);
      }

      // hasOwnProperty, not `in`: a template saying "{{constructor}}" must
      // stay literal rather than interpolating off Object.prototype.
      if (Object.prototype.hasOwnProperty.call(model, braceInner)) {
        return model[braceInner] ?? "";
      }
      const def = LEGACY_BY_TOKEN.get(normalizeToken(braceInner));
      if (def) {
        return model[def.resolverKey] ?? def.defaultValue;
      }
      return match;
    }
  );
}
