import { BaseModel } from '../base.model';
import { FormFieldDef } from './form-field.model';

// A form built in Web Manager > Form Builder. Submissions (see
// FormSubmissionModel) are their own collection, not a subcollection here,
// and snapshot their own copy of the field labels at submit time - a form
// edited or deleted later never corrupts past submission history.
export class FormDefinitionModel extends BaseModel {
  name: string;
  status: 'draft' | 'published';
  fields: FormFieldDef[];
  // Whole-form background - distinct from a field's own FormFieldStyle,
  // which only ever covers that one field's own text.
  backgroundColor?: string;
  // Where this form is actually live, once wired into a public page (e.g.
  // "/consultation-survey" on impactdisciples-web) - purely informational
  // for admins browsing the Form Builder list; nothing in this app reads it
  // to route anywhere. Set by hand once a form is genuinely wired up, not
  // auto-derived from anything.
  publicUrl?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
