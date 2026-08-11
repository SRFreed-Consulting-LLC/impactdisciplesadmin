import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImpactDisciplesCommonModule } from 'src/app/common/impactdisciples.common.module';
import { SharedModule } from '../shared/shared.module';
import { CustomersManagerComponent } from './customers-manager.component';
import { CustomersManagerRoutingModule } from './customers-manager-routing.module';
import { CustomersComponent } from './customers/customers.component';
import { CustomerDialogComponent } from './customers/customer-dialog.component';
import { AddCustomerNoteDialogComponent } from './customers/add-customer-note-dialog.component';
import { PurchasesComponent } from './purchases/purchases.component';
import { PurchaseDetailsComponent } from './purchase-details/purchase-details.component';
import { FulfillmentComponent } from './fulfillment/fulfillment.component';
import { CustomFormSubmissionsComponent } from './custom-form-submissions/custom-form-submissions.component';
import { CustomFormSubmissionDetailDialogComponent } from './custom-form-submissions/custom-form-submission-detail-dialog.component';
import { SubscriptionsComponent } from './subscriptions/subscriptions.component';
import { SubscriberDialogComponent } from './subscriptions/subscriber-dialog.component';
import { SendSubscriptionDialogComponent } from './subscriptions/send-subscription-dialog.component';
import { SubscriptionListDialogComponent } from './subscriptions/subscription-list-dialog.component';
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
import { QuillModule } from 'ngx-quill';

// Everything that's either a customer record or something a customer/site
// visitor submitted - moved here (from admin-manager, store-manager,
// web-manager, subscriptions-manager) so it reads as one coherent group
// instead of scattered across managers organized by internal app area. See
// nav-config.ts's 'customers-manager' group for the full reasoning.
@NgModule({
  imports: [
    CommonModule,
    CustomersManagerRoutingModule,
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
    QuillModule
  ],
  declarations: [
    CustomersManagerComponent,
    CustomersComponent,
    CustomerDialogComponent,
    AddCustomerNoteDialogComponent,
    PurchasesComponent,
    PurchaseDetailsComponent,
    FulfillmentComponent,
    CustomFormSubmissionsComponent,
    CustomFormSubmissionDetailDialogComponent,
    SubscriptionsComponent,
    SubscriberDialogComponent,
    SendSubscriptionDialogComponent,
    SubscriptionListDialogComponent
  ]
})
export class CustomersManagerModule { }
