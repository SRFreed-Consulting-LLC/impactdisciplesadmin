// The one merge-tag substitution engine for email HTML. Tags use the
// *|TAG|* delimiter style (the email builder's native syntax), including the
// inline-fallback form *|TAG|fallback text|*, and every tag also absorbs the
// legacy {{...}} spellings that already exist in the wild - both the
// human-readable tokens the Quill variable-inserter produces
// ("{{Recipient First Name}}") and the camelCase ones the Cloud Functions
// substitute ("{{firstName}}") - so one engine renders builder templates and
// legacy Quill templates alike. Unlike the historical String.replace()
// call sites, this replaces ALL occurrences of every token.
//
// PURE TS - no Angular, no environment imports. *|UNSUB|* resolves to a
// caller-supplied `unsubscribeUrl` in the MergeContext; callers build it from
// environment.unsubscribeUrl (client) or the functions-side constant. This
// keeps the file mirrorable into functions/src/ the same way
// html-to-text.ts is mirrored into transactional-emails.ts.

export interface MergeTagDef {
  tag: string; // FNAME -> written as *|FNAME|*
  label: string; // menu label in the editor
  sample: string; // value used by "preview with sample data"
  resolverKey: string; // key looked up in the MergeContext
  defaultValue: string; // used when the context has no value and no inline fallback
  legacyTokens?: string[]; // exact legacy spellings this tag absorbs
  /**
   * Computes the value when the context has none, for tags that depend on
   * nothing but the moment they render.
   *
   * Every other tag is per-recipient, so a send path has to supply it and
   * `defaultValue` is the "nobody supplied one" "fallback". CURRENT_YEAR is
   * not: it is the same for everyone, it appears in the footer chrome of
   * every mined shell, and requiring FOUR independent send paths to remember
   * it would mean any one of them forgetting renders
   * "Copyright (C)  Impact Discipleship Ministries" to a customer.
   *
   * A function rather than a constant because a Cloud Function instance or a
   * long-lived browser tab can outlive a year boundary.
   */
  dynamicDefault?: () => string;
}

export type MergeContext = Record<string, string | undefined>;

export const MERGE_TAGS: MergeTagDef[] = [
  {
    tag: 'FNAME',
    label: 'First name',
    sample: 'Alex',
    resolverKey: 'firstName',
    defaultValue: '',
    legacyTokens: ['{{Recipient First Name}}', '{{firstName}}']
  },
  {
    tag: 'LNAME',
    label: 'Last name',
    sample: 'Rivera',
    resolverKey: 'lastName',
    defaultValue: '',
    legacyTokens: ['{{Recipient Last Name}}', '{{lastName}}']
  },
  {
    tag: 'EMAIL',
    label: 'Email address',
    sample: 'alex@example.com',
    resolverKey: 'email',
    defaultValue: '',
    legacyTokens: ['{{email}}']
  },
  {
    tag: 'DATE',
    label: "Today's date",
    sample: 'August 17, 2026',
    resolverKey: 'date',
    defaultValue: '',
    legacyTokens: ['{{Date}}']
  },
  {
    tag: 'SENDER_FNAME',
    label: 'Sender first name',
    sample: 'Jordan',
    resolverKey: 'senderFirstName',
    defaultValue: '',
    legacyTokens: ['{{Sender First Name}}']
  },
  {
    tag: 'SENDER_LNAME',
    label: 'Sender last name',
    sample: 'Blake',
    resolverKey: 'senderLastName',
    defaultValue: '',
    legacyTokens: ['{{Sender Last Name}}']
  },
  {
    tag: 'TRACKING',
    label: 'Shipping tracking',
    sample: 'Tracking: TBA123456789',
    resolverKey: 'tracking',
    defaultValue: '',
    legacyTokens: ['{{tracking}}']
  },
  {
    tag: 'UNSUB',
    label: 'Unsubscribe URL',
    sample: '#',
    resolverKey: 'unsubscribeUrl',
    defaultValue: '#'
  },
  {
    // Carried by the footer of every shell mined out of the Mailchimp
    // archive, where it was one of THEIR system tags - registered here so it
    // keeps working now that the account is retired. See
    // scripts/lib/email-chrome-clean.js.
    tag: 'CURRENT_YEAR',
    label: 'Current year',
    sample: String(new Date().getFullYear()),
    resolverKey: 'currentYear',
    defaultValue: '',
    dynamicDefault: () => String(new Date().getFullYear())
  },
  // ------------------------------------------------- per-process variables
  //
  // These were always supplied by their send paths, but only in the legacy
  // {{...}} spelling and never registered here - so the builder's tag menu
  // did not offer them, an admin editing an event confirmation had no way to
  // insert the event's own name, and the tags it DID offer (TRACKING, UNSUB)
  // were the ones that path cannot resolve. Registering them gives each a
  // *|TAG|* spelling and a sample for preview, while `legacyTokens` keeps
  // every template already written against {{eventName}} working unchanged.
  {
    tag: 'EVENT_NAME',
    label: 'Event name',
    sample: 'Disciple-Making Summit',
    resolverKey: 'eventName',
    defaultValue: '',
    legacyTokens: ['{{eventName}}']
  },
  {
    tag: 'START_DATE',
    label: 'Event start date',
    sample: 'March 3, 2027 at 9:00 AM',
    resolverKey: 'startDate',
    defaultValue: '',
    legacyTokens: ['{{startDate}}']
  },
  {
    tag: 'EDIT_REGISTRATION',
    label: 'Breakout registration link',
    sample: '<a href="#">Register for Breakout</a>',
    resolverKey: 'editRegistration',
    defaultValue: '',
    legacyTokens: ['{{editRegistration}}']
  },
  {
    tag: 'ORDER_ITEMS',
    label: 'Order items table',
    sample: '<i>(the order table renders here)</i>',
    resolverKey: 'product_list',
    defaultValue: '',
    legacyTokens: ['{{product_list}}']
  }
];

/**
 * Which variables each kind of template can actually resolve.
 *
 * The menu used to offer all of MERGE_TAGS everywhere, so an event
 * confirmation invited *|TRACKING|* and a product follow-up invited
 * *|UNSUB|* - tags those send paths supply no value for, which render as an
 * empty string in a real customer's email and fail silently. A variable is
 * listed here only where the sending code actually puts it in the model.
 *
 * Keep in step with the send paths:
 *   event/summit  register_for_event (event-registration.functions.ts)
 *   store         queueWebOrderEmails' receipt half
 *   product       queueWebOrderEmails' follow-up half
 *   fulfillment   PurchasesService.sendAmazonConfirmation
 *   campaign      campaign-send.functions.ts
 */
// CURRENT_YEAR is on EVERY line below, which looks like a violation of the
// rule above and is not: the rule exists so the menu never offers a tag that
// renders empty, and this one carries a dynamicDefault, so it resolves on
// every path without any send path supplying it.
export const TAGS_BY_TEMPLATE_KIND: Record<string, readonly string[]> = {
  event: ['FNAME', 'LNAME', 'EMAIL', 'EVENT_NAME', 'START_DATE', 'EDIT_REGISTRATION', 'CURRENT_YEAR'],
  summit: ['FNAME', 'LNAME', 'EMAIL', 'EVENT_NAME', 'START_DATE', 'EDIT_REGISTRATION', 'CURRENT_YEAR'],
  store: ['FNAME', 'LNAME', 'EMAIL', 'ORDER_ITEMS', 'CURRENT_YEAR'],
  product: ['FNAME', 'LNAME', 'EMAIL', 'CURRENT_YEAR'],
  fulfillment: ['FNAME', 'LNAME', 'EMAIL', 'DATE', 'TRACKING', 'CURRENT_YEAR'],
  campaign: ['FNAME', 'LNAME', 'EMAIL', 'DATE', 'SENDER_FNAME', 'SENDER_LNAME', 'UNSUB', 'CURRENT_YEAR'],
  // A template with no kind yet (a brand new design) has no send path to
  // read from, so it gets the safe universal three rather than everything.
  system: ['FNAME', 'LNAME', 'EMAIL', 'CURRENT_YEAR']
};

/**
 * The tags an editor should offer for a template of this kind.
 * An unknown kind falls back to the universal three rather than to
 * everything - offering a tag that cannot resolve is the failure this exists
 * to prevent.
 */
export function mergeTagsForKind(kind: string | undefined): MergeTagDef[] {
  const allowed = TAGS_BY_TEMPLATE_KIND[kind ?? ''] ?? TAGS_BY_TEMPLATE_KIND['system'];
  return MERGE_TAGS.filter((def) => allowed.includes(def.tag));
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Matches the single space in a legacy token against any spelling of a
 *  space the editor might have produced. Quill 2's getSemanticHTML() encodes
 *  EVERY space as `&nbsp;`, so a token inserted through the editor reaches
 *  the sender as `{{Recipient&nbsp;First&nbsp;Name}}` - which an exact
 *  literal match misses, and the tag then renders verbatim in the email.
 *  (Live bug, found 2026-08-24 on a real send.) */
const LEGACY_SPACE = String.raw`(?:\s|&nbsp;|&#160;|&#xa0;)+`;

/** A legacy `{{Some Token}}` as a pattern that tolerates &nbsp; between
 *  its words. Single-word tokens are unaffected. */
function legacyTokenPattern(literal: string): string {
  return literal.split(' ').map(escapeRegExp).join(LEGACY_SPACE);
}

export function mergeTagToken(def: MergeTagDef): string {
  return '*|' + def.tag + '|*';
}


/**
 * The token to INSERT for a picker label. Prefers the modern `*|TAG|*`
 * spelling, which has no spaces for the editor to turn into `&nbsp;` and
 * so cannot be corrupted the way the legacy `{{Some Token}}` form was.
 * Falls back to the legacy spelling for a label that is not a registered
 * tag, which renderMergeTags now matches &nbsp;-tolerantly anyway.
 */
export function mergeTokenForLabel(variableName: string): string {
  const legacy = '{{' + variableName + '}}';
  const def = MERGE_TAGS.find((d) => (d.legacyTokens ?? []).includes(legacy));
  return def ? mergeTagToken(def) : legacy;
}

// Replaces every occurrence of every registered tag (plain, inline-fallback,
// and legacy forms). Unknown/unregistered tags are left untouched.
export function renderMergeTags(html: string, data: MergeContext): string {
  let result = html ?? '';
  for (const def of MERGE_TAGS) {
    // A dynamicDefault stands in for a context value, so it beats an inline
    // fallback too - *|CURRENT_YEAR|2025|* should still render this year.
    const value = data[def.resolverKey] ?? def.dynamicDefault?.();
    const tag = escapeRegExp(def.tag);

    // *|TAG|inline fallback|* - context value wins, else the inline fallback.
    result = result.replace(
      new RegExp('\\*\\|' + tag + '\\|([^|*]*)\\|\\*', 'g'),
      (_match, fallback: string) => value ?? fallback
    );

    // *|TAG|*
    result = result.replace(new RegExp('\\*\\|' + tag + '\\|\\*', 'g'), value ?? def.defaultValue);

    for (const legacy of def.legacyTokens ?? []) {
      result = result.replace(new RegExp(legacyTokenPattern(legacy), 'g'), value ?? def.defaultValue);
    }
  }
  return result;
}

// Context used by the editor's "preview with sample data" toggle.
export function sampleMergeContext(): MergeContext {
  const context: MergeContext = {};
  for (const def of MERGE_TAGS) {
    context[def.resolverKey] = def.sample;
  }
  context['date'] = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  return context;
}

// --------------------------------------------------------------- one pass
//
// Client twin of renderEmailBody in
// functions/src/utils/merge-tags.functions.ts - the transactional renderer
// that resolves BOTH tag syntaxes in a SINGLE scan of the template. Keep the
// two in step; the npm projects share no modules.
//
// It exists because neither renderer above could serve a transactional
// template that is editable in the builder: renderMergeTags knows the closed
// *|TAG|* list but not an event's arbitrary {{eventName}}, and the functions'
// renderPlaceholders knew the reverse. Whichever one a send path used, it
// mailed the other syntax to a customer verbatim.
//
// SINGLE PASS is the security property, not an optimisation: renderMergeTags
// above loops tag by tag over the ACCUMULATING result, so a value substituted
// early is rescanned as if it were template - a registrant named
// "{{editRegistration}}" gets that expanded into their own email. One
// .replace() over the template means substituted text is output, never input.

/** Normalises the inside of a `{{...}}` for legacy lookup: any run of
 *  whitespace or an encoded nbsp collapses to one plain space. */
function normalizeToken(inner: string): string {
  return inner.replace(/(?:\s|&nbsp;|&#160;|&#xa0;)+/g, ' ').trim();
}

const LEGACY_BY_TOKEN = new Map<string, MergeTagDef>();
for (const def of MERGE_TAGS) {
  for (const legacy of def.legacyTokens ?? []) {
    LEGACY_BY_TOKEN.set(normalizeToken(legacy.replace(/^\{\{|\}\}$/g, '')), def);
  }
}
const TAG_BY_NAME = new Map(MERGE_TAGS.map((def) => [def.tag, def]));

// *|TAG|*  |  *|TAG|inline fallback|*  |  {{anything}}
const COMBINED = /\*\|([A-Za-z_][A-Za-z0-9_]*)\|(?:([^|*]*)\|)?\*|\{\{([^{}]*)\}\}/g;

/**
 * Renders a transactional email body, resolving *|TAG|* (with or without an
 * inline fallback) and {{key}} in one pass. Unknown tags in either syntax are
 * left EXACTLY as written - a literal tag in an inbox is a visible bug
 * someone reports, where silently deleting it is not.
 */
export function renderEmailBody(html: string, model: MergeContext): string {
  return (html ?? '').replace(
    COMBINED,
    (match, tagName: string, fallback: string, braceInner: string) => {
      if (tagName !== undefined) {
        const def = TAG_BY_NAME.get(tagName);
        if (!def) {
          return match;
        }
        const value = model[def.resolverKey] ?? def.dynamicDefault?.();
        return value ?? (fallback !== undefined ? fallback : def.defaultValue);
      }
      // hasOwnProperty, not `in` - "{{constructor}}" must stay literal rather
      // than interpolating something off Object.prototype.
      if (Object.prototype.hasOwnProperty.call(model, braceInner)) {
        return model[braceInner] ?? '';
      }
      const def = LEGACY_BY_TOKEN.get(normalizeToken(braceInner));
      if (def) {
        return model[def.resolverKey] ?? def.dynamicDefault?.() ?? def.defaultValue;
      }
      return match;
    }
  );
}
