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
  }
];

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
    const value = data[def.resolverKey];
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
