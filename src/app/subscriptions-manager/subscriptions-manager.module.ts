import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NewsletterSubscriptionComponent } from './newsletter-subscription/newsletter-subscription.component';
import { NewsletterSubscriberDialogComponent } from './newsletter-subscription/newsletter-subscriber-dialog.component';
import { SendNewsletterDialogComponent } from './newsletter-subscription/send-newsletter-dialog.component';
import { NewsletterListDialogComponent } from './newsletter-subscription/newsletter-list-dialog.component';
import { PrayerTeamSubscriptionComponent } from './prayer-team-subscription/prayer-team-subscription.component';
import { PrayerSubscriberDialogComponent } from './prayer-team-subscription/prayer-subscriber-dialog.component';
import { SendPrayerDialogComponent } from './prayer-team-subscription/send-prayer-dialog.component';
import { PrayerListDialogComponent } from './prayer-team-subscription/prayer-list-dialog.component';
import { PhoneNumberMaskPipe } from 'src/app/common/pipes/phone-number.pipe';
import { ImpactDisciplesCommonModule } from 'src/app/common/impactdisciples.common.module';
import { SubscriptionsManagerComponent } from './subscriptions-manager.component';
import { SharedModule } from '../shared/shared.module';
import { SubscriptionsManagerRoutingModule } from './subscriptions-manager-routing.module';
import { ReactiveFormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { QuillModule } from 'ngx-quill';


@NgModule({
  imports: [
    CommonModule,
    SubscriptionsManagerRoutingModule,
    ImpactDisciplesCommonModule,
    SharedModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatTableModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatSelectModule,
    MatCheckboxModule,
    QuillModule
  ],
  declarations: [
    SubscriptionsManagerComponent,
    NewsletterSubscriptionComponent,
    NewsletterSubscriberDialogComponent,
    SendNewsletterDialogComponent,
    NewsletterListDialogComponent,
    PrayerTeamSubscriptionComponent,
    PrayerSubscriberDialogComponent,
    SendPrayerDialogComponent,
    PrayerListDialogComponent
  ],
  providers:[
    PhoneNumberMaskPipe
  ]
})
export class SubscriptionsManagerModule { }
