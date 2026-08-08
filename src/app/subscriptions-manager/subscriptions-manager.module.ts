import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DxButtonModule, DxContextMenuModule, DxDataGridModule, DxFileUploaderModule, DxFormModule, DxHtmlEditorModule, DxLoadIndicatorModule, DxPopupModule, DxSelectBoxModule,
  DxSwitchModule, DxTabsModule, DxTextBoxModule, DxToolbarModule } from 'devextreme-angular';
import { NewsletterSubscriptionComponent } from './newsletter-subscription/newsletter-subscription.component';
import { PrayerTeamSubscriptionComponent } from './prayer-team-subscription/prayer-team-subscription.component';
import { PhoneNumberMaskPipe } from 'impactdisciplescommon/src/pipes/phone-number.pipe';
import { ImpactDisciplesCommonModule } from 'impactdisciplescommon/src/impactdisciples.common.module';
import { SubscriptionsManagerComponent } from './subscriptions-manager.component';
import { SharedModule } from "../shared/shared.module";
import { ImageUploaderModule } from 'impactdisciplescommon/src/forms/image-uploader/image-uploader.module';
import { SubscriptionsManagerRoutingModule } from './subscriptions-manager-routing.module';


@NgModule({
  imports: [
    CommonModule,
    SubscriptionsManagerRoutingModule,
    ImageUploaderModule,
    DxContextMenuModule,
    DxDataGridModule,
    DxButtonModule,
    DxFormModule,
    DxFileUploaderModule,
    DxHtmlEditorModule,
    DxLoadIndicatorModule,
    DxPopupModule,
    DxSelectBoxModule,
    DxSwitchModule,
    DxTabsModule,
    DxTextBoxModule,
    DxToolbarModule,
    ImpactDisciplesCommonModule,
    SharedModule
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
