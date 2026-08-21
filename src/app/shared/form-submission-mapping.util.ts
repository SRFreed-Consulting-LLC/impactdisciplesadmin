import { FormSubmissionModel } from '@impact-common/shared/models/domain/form-submission.model';
import { FormFieldType } from '@impact-common/shared/models/domain/form-field.model';
import { Address } from '@impact-common/shared/models/domain/utils/address.model';
import { Phone } from '@impact-common/shared/models/domain/utils/phone.model';

// Label-heuristic extraction over a form submission's UUID-keyed values -
// the ONE place that guesses what a dynamic form's fields mean (fields are
// whatever the admin dragged onto the Form Builder canvas; there is no
// semantic role on FormFieldDef, deliberately - see the Contacts & Events
// restructure plan: a heuristic miss here costs the admin one manual edit
// in the fully editable Create Organization/Contact dialog, and this works
// on every historical submission with no builder or web-repo changes).
// Absorbs the previously duplicated submitterIdentity() heuristics from
// route-request-dialog.component.ts and dashboard.component.ts.

export interface ExtractedSubmission {
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: Phone;
  address?: Address;
  // A church/location/organization name - its presence is what qualifies a
  // submission for "Create Organization + Contact" (vs contact-only).
  orgName?: string;
  // True when there's enough person identity (an email or a name) to offer
  // "Create Contact" at all.
  hasIdentity: boolean;
}

interface SnapshotField {
  id: string;
  label: string;
  type: FormFieldType;
}

function fields(item: FormSubmissionModel): SnapshotField[] {
  return (item.fieldSnapshot ?? []) as SnapshotField[];
}

function valueOf(item: FormSubmissionModel, field: SnapshotField | undefined): unknown {
  return field ? item.values?.[field.id] : undefined;
}

function textValue(item: FormSubmissionModel, field: SnapshotField | undefined): string | undefined {
  const value = valueOf(item, field);
  const text = typeof value === 'string' ? value.trim() : '';
  return text || undefined;
}

const ORG_LABEL = /church name|location name|organization|ministry name/i;

export function extractSubmission(item: FormSubmissionModel): ExtractedSubmission {
  const all = fields(item);
  const texts = all.filter((f) => f.type === 'text');

  const email = textValue(item, all.find((f) => f.type === 'email'))?.toLowerCase();

  let firstName = textValue(item, texts.find((f) => /first\s*name|^first\b/i.test(f.label)));
  let lastName = textValue(item, texts.find((f) => /last\s*name|^last\b/i.test(f.label)));

  // Single combined name field ("Name", "Event Coordinator") - split first
  // token / remainder. Org-ish labels are excluded so "Church Name" never
  // masquerades as a person.
  if (!firstName && !lastName) {
    const combined =
      textValue(item, texts.find((f) => /name/i.test(f.label) && !ORG_LABEL.test(f.label) && !/coordinator/i.test(f.label))) ??
      textValue(item, texts.find((f) => /coordinator/i.test(f.label)));
    if (combined) {
      const parts = combined.split(/\s+/);
      firstName = parts[0];
      lastName = parts.length > 1 ? parts.slice(1).join(' ') : undefined;
    }
  }

  const phoneValue = valueOf(item, all.find((f) => f.type === 'phone')) as Phone | undefined;
  const addressValue = valueOf(item, all.find((f) => f.type === 'address')) as Address | undefined;
  const orgName = textValue(item, texts.find((f) => ORG_LABEL.test(f.label)));

  return {
    email,
    firstName,
    lastName,
    ...(phoneValue && typeof phoneValue === 'object' ? { phone: phoneValue } : {}),
    ...(addressValue && typeof addressValue === 'object' ? { address: addressValue } : {}),
    orgName,
    hasIdentity: !!(email || firstName || lastName)
  };
}

// Best-effort display identity - prefer an email-type field's value, then a
// name-like text field, then give up rather than guess wrong. Shared by the
// dashboard's New Requests table and the Forward Request dialog.
export function submitterIdentity(item: FormSubmissionModel): string {
  const all = fields(item);
  const email = textValue(item, all.find((f) => f.type === 'email'));
  if (email) {
    return email;
  }
  const name = textValue(item, all.find((f) => f.type === 'text' && /name/i.test(f.label)));
  return name ?? 'Unknown';
}
