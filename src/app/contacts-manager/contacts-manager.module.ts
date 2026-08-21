import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImpactDisciplesCommonModule } from 'src/app/common/impactdisciples.common.module';
import { SharedModule } from '../shared/shared.module';
import { ContactsManagerComponent } from './contacts-manager.component';
import { ContactsManagerRoutingModule } from './contacts-manager-routing.module';
import { ContactsComponent } from './contacts/contacts.component';
import { ContactDetailsComponent } from './contacts/contact-details.component';
import { ContactTimelineComponent } from './contacts/contact-timeline/contact-timeline.component';
import { ContactDetailsDialogComponent } from './contacts/contact-details-dialog.component';
import { AddContactNoteDialogComponent } from './contacts/add-contact-note-dialog.component';
import { PurchasesComponent } from './purchases/purchases.component';
import { PurchaseDetailsComponent } from './purchase-details/purchase-details.component';
import { OrderTimelineComponent } from './purchase-details/order-timeline/order-timeline.component';
import { FulfillmentComponent } from './fulfillment/fulfillment.component';
import { CustomFormSubmissionsComponent } from './custom-form-submissions/custom-form-submissions.component';
import { CustomFormSubmissionDetailDialogComponent } from './custom-form-submissions/custom-form-submission-detail-dialog.component';
// Organizations moved here from Events Manager in the 2026-08 restructure -
// an organization is a contact-world record (see nav-config.ts).
import { OrganizationsComponent } from './organizations/organizations.component';
import { OrganizationDetailsComponent } from './organizations/organization-details.component';
import { OrganizationLocationDialogComponent } from './organizations/organization-location-dialog.component';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTabsModule } from '@angular/material/tabs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatExpansionModule } from '@angular/material/expansion';

// Everything that's either a customer record or something a customer/site
// visitor submitted - moved here (from admin-manager, store-manager,
// content-manager, subscriptions-manager) so it reads as one coherent group
// instead of scattered across managers organized by internal app area. See
// nav-config.ts's 'contacts-manager' group for the full reasoning.
@NgModule({
  imports: [
    CommonModule,
    ContactsManagerRoutingModule,
    ImpactDisciplesCommonModule,
    SharedModule,
    FormsModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatTableModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatSlideToggleModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatSelectModule,
    MatCheckboxModule,
    MatTabsModule,
    MatToolbarModule,
    MatMenuModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatExpansionModule
  ],
  declarations: [
    ContactsManagerComponent,
    ContactsComponent,
    ContactDetailsComponent,
    ContactTimelineComponent,
    ContactDetailsDialogComponent,
    AddContactNoteDialogComponent,
    PurchasesComponent,
    PurchaseDetailsComponent,
    OrderTimelineComponent,
    FulfillmentComponent,
    CustomFormSubmissionsComponent,
    CustomFormSubmissionDetailDialogComponent,
    OrganizationsComponent,
    OrganizationDetailsComponent,
    OrganizationLocationDialogComponent
  ]
})
export class ContactsManagerModule { }
