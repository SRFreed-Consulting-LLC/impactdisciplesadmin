import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { OrganizationModel, OrganizationPointOfContact } from '@impact-common/shared/models/domain/organization.model';
import { OrganizationService } from 'src/app/common/services/data/organization.service';
import { LocationModel } from '@impact-common/shared/models/domain/location.model';
import { LocationService } from 'src/app/common/services/data/location.service';
import { ContactModel } from 'src/app/common/models/domain/utils/contact.model';
import { ContactService } from 'src/app/common/services/data/contact.service';
import { EventService } from 'src/app/common/services/data/event.service';
import { Role } from '@impact-common/shared/lists/roles.enum';
import { SnackbarService } from '../../shared/snackbar.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { ContactDetailsDialogComponent } from '../contacts/contact-details-dialog.component';
import { OrganizationLocationDialogComponent } from './organization-location-dialog.component';

// Full in-page edit view for one organization (hosted by
// OrganizationsComponent's mode switch - the ContactsComponent /
// ContactDetailsComponent precedent). Four sections:
//   1. Org info - name/email/website/address/phone. The org's own address
//      IS the venue for events at a single-site org (see EventModel.venue).
//   2. Point of Contact - structured person, promotable to a real Contact
//      ("Promote to Contact" creates-or-links a customers doc by email;
//      the ONE sanctioned admin-side contact creation, see
//      contact.model.ts's header comment).
//   3. Locations - this org's child `locations` docs (parent-child via
//      location.organization). No rooms editing here - rooms belong to the
//      pinned Summit venue and are edited on the Summit screen only.
//   4. Members - contacts whose organizationId points here ("the people
//      inside these organizations"); link by email, unlink, or open one.
@Component({
    selector: 'app-organization-details',
    templateUrl: './organization-details.component.html',
    styleUrls: ['./organization-details.component.scss'],
    standalone: false
})
export class OrganizationDetailsComponent implements OnInit {
  @Input() item: OrganizationModel | null = null;
  @Output() closed = new EventEmitter<void>();

  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit = false;

  locations: LocationModel[] = [];
  members: ContactModel[] = [];
  loadingChildren = false;

  // Email typed into the "Link existing contact" inline field.
  linkEmail = '';
  linking = false;
  promoting = false;

  constructor(
    private fb: FormBuilder,
    private service: OrganizationService,
    private locationService: LocationService,
    private contactService: ContactService,
    private eventService: EventService,
    private dialog: MatDialog,
    private snackbar: SnackbarService,
    private confirmService: ConfirmService
  ) {}

  ngOnInit(): void {
    this.isEdit = !!this.item?.id;
    const poc = this.item?.pointOfContact;
    this.form = this.fb.group({
      name: [this.item?.name ?? '', Validators.required],
      email: [this.item?.email ?? ''],
      website: [this.item?.website ?? ''],
      address: this.fb.group({
        address1: [this.item?.address?.address1 ?? ''],
        address2: [this.item?.address?.address2 ?? ''],
        city: [this.item?.address?.city ?? ''],
        state: [this.item?.address?.state ?? ''],
        zip: [this.item?.address?.zip ?? '']
      }),
      phone: this.fb.group({
        countryCode: [this.item?.phone?.countryCode ?? ''],
        number: [this.item?.phone?.number ?? ''],
        type: [this.item?.phone?.type ?? null]
      }),
      pointOfContact: this.fb.group({
        firstName: [poc?.firstName ?? ''],
        lastName: [poc?.lastName ?? ''],
        email: [poc?.email ?? ''],
        phone: this.fb.group({
          countryCode: [poc?.phone?.countryCode ?? ''],
          number: [poc?.phone?.number ?? ''],
          type: [poc?.phone?.type ?? null]
        })
      })
    });

    if (this.isEdit) {
      this.loadChildren();
    }
  }

  private async loadChildren(): Promise<void> {
    this.loadingChildren = true;
    try {
      [this.locations, this.members] = await Promise.all([
        this.locationService.getAllByValue('organization', this.item!.id),
        this.contactService.getAllByValue('organizationId', this.item!.id)
      ]);
      this.locations.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
      this.members.sort((a, b) => (a.lastName ?? '').localeCompare(b.lastName ?? ''));
    } finally {
      this.loadingChildren = false;
    }
  }

  memberName(contact: ContactModel): string {
    return [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.email;
  }

  pocContactId(): string | undefined {
    return this.item?.pointOfContact?.contactId;
  }

  // ---- Save / close ----

  onBack(): void {
    this.closed.emit();
  }

  // Assembles the doc from the form, carrying forward anything the form
  // doesn't edit (deprecated contactName, the PoC's contactId link).
  private buildValue(): OrganizationModel {
    const v = this.form.value;
    const pointOfContact: OrganizationPointOfContact = {
      ...(this.item?.pointOfContact ?? {}),
      firstName: v.pointOfContact.firstName ?? '',
      lastName: v.pointOfContact.lastName ?? '',
      email: v.pointOfContact.email ?? '',
      phone: v.pointOfContact.phone
    };
    return {
      ...this.item,
      name: v.name,
      email: v.email ?? '',
      website: v.website ?? '',
      address: v.address,
      phone: v.phone,
      pointOfContact
    } as OrganizationModel;
  }

  async onSave(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.inProgress$.next(true);
    try {
      const value = this.buildValue();
      if (this.isEdit) {
        await this.service.update(value.id!, value);
        this.snackbar.success('Organization Updated');
        this.closed.emit();
      } else {
        const created = await this.service.add(value);
        this.snackbar.success('Organization Added');
        // Stay on the page in edit mode so locations/members can be added
        // right away - a brand-new org is exactly when you want to attach
        // its locations.
        this.item = created ?? value;
        this.isEdit = !!this.item?.id;
        if (this.isEdit) {
          this.loadChildren();
        }
      }
    } catch {
      this.snackbar.somethingWentWrong();
    } finally {
      this.inProgress$.next(false);
    }
  }

  // ---- Point of Contact -> Contact ----

  // Creates-or-links a customers doc for the PoC by email (same lowercased
  // match key the customer-upsert functions use). Never overwrites an
  // existing contact's profile fields - it only sets organizationId.
  async promoteToContact(): Promise<void> {
    const poc = this.form.value.pointOfContact;
    const email = (poc.email ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      this.snackbar.error('The point of contact needs an email address first.');
      return;
    }
    if (!this.isEdit) {
      this.snackbar.error('Save the organization first.');
      return;
    }
    this.promoting = true;
    try {
      const existing = await this.contactService.getAllByValue('email', email);
      let contact = existing[0];
      if (contact) {
        await this.contactService.update(contact.id!, { ...contact, organizationId: this.item!.id } as ContactModel);
      } else {
        contact = await this.contactService.add({
          firstName: poc.firstName ?? '',
          lastName: poc.lastName ?? '',
          email,
          ...(poc.phone?.number ? { phone: poc.phone } : {}),
          role: Role.CUSTOMER,
          notes: [],
          pendingChanges: [],
          tags: [],
          organizationId: this.item!.id
        } as unknown as ContactModel);
      }
      const updated: OrganizationModel = {
        ...this.buildValue(),
        pointOfContact: { ...this.buildValue().pointOfContact, contactId: contact.id }
      };
      await this.service.update(this.item!.id!, updated);
      this.item = updated;
      this.snackbar.success(existing.length ? 'Linked to the existing contact' : 'Contact created and linked');
      this.loadChildren();
    } catch {
      this.snackbar.somethingWentWrong();
    } finally {
      this.promoting = false;
    }
  }

  // ---- Locations ----

  addLocation(): void {
    this.openLocationDialog(null);
  }

  editLocation(location: LocationModel): void {
    this.openLocationDialog(location);
  }

  private openLocationDialog(location: LocationModel | null): void {
    if (!this.isEdit) {
      this.snackbar.error('Save the organization first.');
      return;
    }
    const ref = this.dialog.open(OrganizationLocationDialogComponent, {
      width: '700px',
      data: { item: location, organizationId: this.item!.id }
    });
    ref.afterClosed().subscribe((changed) => {
      if (changed) {
        this.loadChildren();
      }
    });
  }

  deleteLocation(location: LocationModel): void {
    if (location.isSummitVenue) {
      this.snackbar.error('This is the pinned Summit venue - it cannot be deleted.');
      return;
    }
    this.confirmService.confirm('<i>Delete this location? Events that pointed at it keep their saved venue snapshot.</i>', 'Confirm').then(async (confirmed) => {
      if (confirmed) {
        await this.locationService.delete(location.id!);
        this.snackbar.success('Location Deleted');
        this.loadChildren();
      }
    });
  }

  // ---- Members ----

  async linkContactByEmail(): Promise<void> {
    const email = this.linkEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      this.snackbar.error('Enter the contact\'s email address.');
      return;
    }
    if (!this.isEdit) {
      this.snackbar.error('Save the organization first.');
      return;
    }
    this.linking = true;
    try {
      const matches = await this.contactService.getAllByValue('email', email);
      const contact = matches[0];
      if (!contact) {
        this.snackbar.error('No contact record found for that email.');
        return;
      }
      await this.contactService.update(contact.id!, { ...contact, organizationId: this.item!.id } as ContactModel);
      this.linkEmail = '';
      this.snackbar.success('Contact linked');
      this.loadChildren();
    } finally {
      this.linking = false;
    }
  }

  unlinkMember(contact: ContactModel): void {
    this.confirmService.confirm(`<i>Remove <b>${this.memberName(contact)}</b> from this organization? The contact record itself is kept.</i>`, 'Confirm').then(async (confirmed) => {
      if (confirmed) {
        // null, never undefined - see the Firestore write gotcha in CLAUDE.md.
        await this.contactService.update(contact.id!, { ...contact, organizationId: null } as unknown as ContactModel);
        this.snackbar.success('Contact unlinked');
        this.loadChildren();
      }
    });
  }

  async viewMember(contact: ContactModel): Promise<void> {
    // Same dialog + data shape as PurchaseDetailsComponent.viewCustomer().
    const events = await this.eventService.getAll();
    const ref = this.dialog.open(ContactDetailsDialogComponent, {
      width: '1100px',
      maxWidth: '95vw',
      height: '85vh',
      data: { item: contact, events }
    });
    ref.afterClosed().subscribe(() => this.loadChildren());
  }
}
