import { BaseModel } from '../base.model';
import { FormFieldType } from './form-field.model';

// A single submission of a Form Builder form, viewed under Web Manager >
// Custom Form Submissions. formName/fieldSnapshot are deliberately
// denormalized copies taken at submit time (not a live join back to the
// FormDefinitionModel doc) so the submissions list and detail view stay
// correct even if that form is later edited or deleted.
export class FormSubmissionModel extends BaseModel {
  formId: string;
  formName: string;
  fieldSnapshot: { id: string; label: string; type: FormFieldType }[];
  // Keyed by FormFieldDef.id. Layout fields (heading/instructions/divider/
  // columns) never appear here - only fields with an actual submitted value.
  values: Record<string, unknown>;
  submittedAt: Date;
  // Set on submissions made via the builder's own "Preview & Test Submit"
  // action, so the whole storage -> submissions-list -> detail-view pipeline
  // is verifiable inside the admin app before any public-facing form exists.
  isTest?: boolean;
  // Drives NewRecordTracker's row highlight - see new-record-tracking.util.ts.
  // Field name/values match NewRecordTrackable exactly, no changes needed there.
  newRecordStatus?: 'new' | 'seen';
}
