import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DxButtonModule, DxDataGridModule, DxFileUploaderModule, DxFormModule, DxHtmlEditorModule, DxLoadIndicatorModule, DxPopupModule,
         DxSwitchModule, DxTabsModule, DxTextBoxModule } from 'devextreme-angular';
import { NewsletterSubscriptionComponent } from './newsletter-subscription/newsletter-subscription.component';
import { PrayerTeamSubscriptionComponent } from './prayer-team-subscription/prayer-team-subscription.component';
import { ImpactFormsModule } from 'impactdisciplescommon/src/forms/forms.module';
import { PhoneNumberMaskPipe } from 'impactdisciplescommon/src/pipes/phone-number.pipe';
import { ImpactDisciplesModule } from 'impactdisciplescommon/src/impactdisciples.common.module';
import { SubscriptionsManagerComponent } from './subscriptions-manager.component';


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
    DxTabsModule,
    DxTextBoxModule,
    ImpactDisciplesModule
  ],
  declarations: [
    SubscriptionsManagerComponent,
    NewsletterSubscriptionComponent,
    PrayerTeamSubscriptionComponent
  ],
  providers:[
    PhoneNumberMaskPipe
  ]
})
export class SubscriptionsManagerModule { }