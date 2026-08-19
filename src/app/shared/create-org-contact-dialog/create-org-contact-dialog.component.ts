import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { FormSubmissionModel } from 'src/app/common/models/domain/form-submission.model';
import { FormSubmissionService } from 'src/app/common/services/data/form-submission.service';
import { OrganizationModel } from 'src/app/common/models/domain/organization.model';
import { OrganizationService } from 'src/app/common/services/data/organization.service';
import { ContactModel } from 'src/app/common/models/domain/utils/contact.model';
import { ContactService } from 'src/app/common/services/data/contact.service';
import { Role } from 'src/app/common/lists/roles.enum';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { AdminUser } from 'src/app/common/models/admin/admin-user.model';
import { SnackbarService } from '../snackbar.service';
import { extractSubmission } from '../form-submission-mapping.util';

export interface CreateOrgContactDialogData {
  submission: FormSubmissionModel;
  // 'org' = Create Organization + Contact (submission carried an org-name
  // field), 'contact' = Create Contact only. Decided by the caller via
  // extractSubmission().orgName.
  mode: 'org' | 'contact';
}

export interface CreateOrgContactDialogResult {
  organizationId?: string;
  contactId?: string;
}

// The admin-reviewed path from an inbound request to real records (user
// decision: NEVER automatic - free-text church names guarantee duplicate
// orgs without a human eye). Pre-filled from the submission via the shared
// label heuristics, everything editable. Dedupe before create:
//   - org by normalized name against the (small) organizations collection -
//     a match offers link-instead mode, no second org doc;
//   - contact by lowercased email - an existing contact only gets
//     organizationId set, its profile fields are never overwritten (the
//     same philosophy as the customer-upsert pendingChanges flow).
// On save the submission is stamped with createdRecords (a staff update -
// not subject to the anonymous-create rules shape lock).
@Component({
    selector: 'app-create-org-contact-dialog',
    templateUrl: './create-org-contact-dialog.component.html',
    styleUrls: ['./create-org-contact-dialog.component.scss'],
    standalone: false
})
export class CreateOrgContactDialogComponent implements OnInit {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  mode: 'org' | 'contact';

  private organizations: OrganizationModel[] = [];
  // Set when the typed org name matches an existing org - the banner offers
  // linking to it instead of creating a duplicate.
  matchedOrg: OrganizationModel | null = null;
  linkToExisting = false;

  // Set when the contact email already exists - informational; the save
  // links rather than duplicates either way.
  existingContactEmail = false;

  constructor(
    private dialogRef: MatDialogRef<CreateOrgContactDialogComponent, CreateOrgContactDialogResult | undefined>,
    @Inject(MAT_DIALOG_DATA) public data: CreateOrgContactDialogData,
    private fb: FormBuilder,
    private organizationService: OrganizationService,
    private contactService: ContactService,
    private submissionService: FormSubmissionService,
    private authService: AdminAuthService,
    private snackbar: SnackbarService
  ) {
    this.mode = data.mode;
    const extracted = extractSubmission(data.submission);

    this.form = this.fb.group({
      org: this.fb.group({
        name: [extracted.orgName ?? '', this.mode === 'org' ? Validators.required : []],
        email: [''],
        website: [''],
        address: this.fb.group({
          address1: [extracted.address?.address1 ?? ''],
          address2: [extracted.address?.address2 ?? ''],
          city: [extracted.address?.city ?? ''],
          state: [extracted.address?.state ?? ''],
          zip: [extracted.address?.zip ?? '']
        }),
        phone: this.fb.group({
          countryCode: [extracted.phone?.countryCode ?? ''],
          number: [extracted.phone?.number ?? ''],
          type: [extracted.phone?.type ?? null]
        })
      }),
      contact: this.fb.group({
        firstName: [extracted.firstName ?? ''],
        lastName: [extracted.lastName ?? ''],
        email: [extracted.email ?? '', [Validators.required, Validators.email]],
        phone: this.fb.group({
          countryCode: [extracted.phone?.countryCode ?? ''],
          number: [extracted.phone?.number ?? ''],
          type: [extracted.phone?.type ?? null]
        })
      })
    });
  }

  ngOnInit(): void {
    if (this.mode === 'org') {
      this.organizationService.getAll().then((organizations) => {
        this.organizations = organizations;
        this.checkOrgMatch(this.form.get('org.name')?.value);
        this.form.get('org.name')?.valueChanges.subscribe((name) => this.checkOrgMatch(name));
      });
    }
    const email = (this.form.get('contact.email')?.value ?? '').trim().toLowerCase();
    if (email) {
      this.contactService.getAllByValue('email', email).then((matches) => {
        this.existingContactEmail = matches.length > 0;
      });
    }
  }

  private checkOrgMatch(name: string): void {
    const norm = (s?: string) => (s ?? '').trim().toLowerCase();
    this.matchedOrg = this.organizations.find((o) => norm(o.name) === norm(name) && norm(name)) ?? null;
    if (!this.matchedOrg) {
      this.linkToExisting = false;
    }
  }

  setLinkToExisting(link: boolean): void {
    this.linkToExisting = link;
    const orgGroup = this.form.get('org');
    if (link) {
      orgGroup?.disable();
    } else {
      orgGroup?.enable();
    }
  }

  onCancel(): void {
    this.dialogRef.close(undefined);
  }

  async onSave(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.inProgress$.next(true);
    try {
      const contactValue = this.form.get('contact')?.value;
      const email = (contactValue.email ?? '').trim().toLowerCase();

      // 1. The organization (org mode only) - create or link.
      let organizationId: string | undefined;
      if (this.mode === 'org') {
        if (this.linkToExisting && this.matchedOrg) {
          organizationId = this.matchedOrg.id;
        } else {
          const orgValue = this.form.get('org')?.getRawValue();
          const created = await this.organizationService.add({
            name: orgValue.name,
            email: orgValue.email ?? '',
            website: orgValue.website ?? '',
            address: orgValue.address,
            phone: orgValue.phone,
            pointOfContact: {
              firstName: contactValue.firstName ?? '',
              lastName: contactValue.lastName ?? '',
              email,
              phone: contactValue.phone
            }
          } as OrganizationModel);
          organizationId = created?.id;
        }
      }

      // 2. The contact - create or link by email (never overwrite an
      // existing contact's profile fields).
      const matches = await this.contactService.getAllByValue('email', email);
      let contact = matches[0];
      if (contact) {
        if (organizationId) {
          await this.contactService.update(contact.id!, { ...contact, organizationId } as ContactModel);
        }
      } else {
        contact = await this.contactService.add({
          firstName: contactValue.firstName ?? '',
          lastName: contactValue.lastName ?? '',
          email,
          ...(contactValue.phone?.number ? { phone: contactValue.phone } : {}),
          role: Role.CUSTOMER,
          notes: [],
          pendingChanges: [],
          tags: [],
          ...(organizationId ? { organizationId } : {})
        } as unknown as ContactModel);
      }

      // 3. Back-link the org's PoC to the contact doc.
      if (organizationId && !this.linkToExisting && contact?.id) {
        const org = await this.organizationService.getById(organizationId);
        if (org) {
          await this.organizationService.update(organizationId, {
            ...org,
            pointOfContact: { ...(org.pointOfContact ?? {}), contactId: contact.id }
          } as OrganizationModel);
        }
      }

      // 4. Stamp the submission (staff update - allowed by rules).
      const user = this.authService.getLoggedInUser() as AdminUser | undefined;
      const by = user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email : undefined;
      await this.submissionService.update(this.data.submission.id!, {
        ...this.data.submission,
        createdRecords: {
          ...(organizationId ? { organizationId } : {}),
          ...(contact?.id ? { contactId: contact.id } : {}),
          at: new Date(),
          ...(by ? { by } : {})
        }
      } as FormSubmissionModel);

      this.snackbar.success(
        this.mode === 'org'
          ? (this.linkToExisting ? 'Linked to the existing organization and contact saved' : 'Organization and contact created')
          : (matches.length ? 'Linked to the existing contact' : 'Contact created')
      );
      this.dialogRef.close({ organizationId, contactId: contact?.id });
    } catch {
      this.snackbar.error('Some Error Occured');
      this.inProgress$.next(false);
    }
  }
}
