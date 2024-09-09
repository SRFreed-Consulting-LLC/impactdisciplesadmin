import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LogMessagesComponent } from './log-messages/log-messages.component';
import { UsersComponent } from './users/users.component';
import { DxButtonModule, DxDataGridModule, DxFileUploaderModule, DxFormModule, DxHtmlEditorModule, DxLoadIndicatorModule, DxPopupModule, DxSwitchModule, DxTextBoxModule } from 'devextreme-angular';
import { NotificationsComponent } from './notifications/notifications.component';
import { NewsletterSupscriptionComponent } from './subscriptions/newsletter-supscription/newsletter-supscription.component';
import { PrayerTeamSubscriptionComponent } from './subscriptions/prayer-team-subscription/prayer-team-subscription.component';
import { SubscriptionsComponent } from './subscriptions/subscriptions.component';
import { PodCastsComponent } from './media/pod-casts/pod-casts.component';
import { BlogPostsComponent } from './media/blog-posts/blog-posts.component';
import { MediaComponent } from './media/media.component';
import { CouponManagerComponent } from './coupon-manager/coupon-manager.component';
import { WebConfigManagerComponent } from './web-config-manager/web-config-manager.component';
import { ImpactFormsModule } from 'impactdisciplescommon/src/forms/forms.module';
import { RequestsComponent } from './requests/requests.component';
import { LunchAndLearnsComponent } from './requests/lunch-and-learns/lunch-and-learns.component';
import { SeminarsComponent } from './requests/seminars/seminars.component';
import { PhoneNumberMaskPipe } from 'impactdisciplescommon/src/pipes/phone-number.pipe';
import { ImpactDisciplesModule } from 'impactdisciplescommon/src/impactdisciples.common.module';
import { TestimonialsManagerComponent } from './testimonials-manager/testimonials-manager.component';


@NgModule({
  imports: [
    CommonModule,
    ImpactFormsModule,
    DxDataGridModule,
    DxButtonModule,
    DxFormModule,
    DxFileUploaderModule,
    DxHtmlEditorModule,
    DxLoadIndicatorModule,
    DxPopupModule,
    DxSwitchModule,
    DxTextBoxModule,
    ImpactDisciplesModule
  ],
  declarations: [
    LogMessagesComponent,
    UsersComponent,
    NotificationsComponent,
    NewsletterSupscriptionComponent,
    PrayerTeamSubscriptionComponent,
    SubscriptionsComponent,
    MediaComponent,
    PodCastsComponent,
    BlogPostsComponent,
    CouponManagerComponent,
    WebConfigManagerComponent,
    RequestsComponent,
    LunchAndLearnsComponent,
    SeminarsComponent,
    TestimonialsManagerComponent
  ],
  providers:[
    PhoneNumberMaskPipe
  ]
})
export class AdminModule { }
