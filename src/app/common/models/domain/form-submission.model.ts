import { BaseModel } from '../base.model';
import { FormFieldType } from './form-field.model';

// A single submission of a Form Builder form, viewed under Web Manager >
// Custom Form Submissions. formName/fieldSnapshot are deliberately
// denormalized copies taken at submit time (not a live join back to the
// FormDefinitionModel doc) so the submissions list and detail view stay
// correct even if that form is later edited or deleted.
// Stamped by the admin-reviewed "Create Organization/Contact from this
// request" flow (create-org-contact-dialog) - which records got created or
// linked from this submission. A staff UPDATE, so it isn't blocked by the
// anonymous-create shape lock in firestore.rules (that applies to `create`
// only, same as the routing fields below).
export interface FormSubmissionCreatedRecords {
  organizationId?: string;
  contactId?: string;
  at: Date;
  by?: string;
}

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

  // Routing workflow (see RouteRequestDialogComponent) - undefined/'open'
  // means the request still shows on the dashboard's New Requests section;
  // 'routed' means an admin has forwarded it to a staff person (or emailed
  // an outside address) and it's considered handled, so the dashboard hides
  // it. Custom Form Submissions (Web Manager) still shows every submission
  // regardless of status, with a Status column + Reopen action to bring a
  // misrouted one back. routedTo/routedNote/routedAt/routedBy are kept
  // around after a Reopen (not cleared) so the last routing is still visible
  // as history even once status flips back to 'open'.
  status?: 'open' | 'routed';
  routedTo?: { name: string; email: string };
  routedNote?: string;
  routedAt?: Date;
  routedBy?: string;

  // See FormSubmissionCreatedRecords above.
  createdRecords?: FormSubmissionCreatedRecords;
}
