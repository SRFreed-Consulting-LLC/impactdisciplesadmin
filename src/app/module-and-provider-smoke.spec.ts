import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { Storage } from '@angular/fire/storage';
import { AddContactNoteDialogComponent } from 'src/app/contacts-manager/contacts/add-contact-note-dialog.component';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { AdminManagerModule } from 'src/app/admin-manager/admin-manager.module';
import { AdminManagerRoutingModule } from 'src/app/admin-manager/admin-manager-routing.module';
import { AdminUserService } from 'src/app/common/services/data/admin-user.service';
import { AgendaItemDialogComponent } from 'src/app/events-manager/events/event-agenda/agenda-item-dialog.component';
import { AmazonConfirmationDialogComponent } from 'src/app/shared/amazon-confirmation-dialog/amazon-confirmation-dialog.component';
import { AppModule } from 'src/app/app.module';
import { AppRoutingModule } from 'src/app/app-routing.module';
import { assembleLibraryLessonSchema } from 'src/app/common/services/data/library/library-book-schema-assembler.util';
import { AuthModule } from 'src/app/core/auth/auth.module';
import { BLOCK_PALETTE_ID } from 'src/app/tools-manager/email-designer/block-drop.util';
import { BlockStyleEditorComponent } from 'src/app/tools-manager/email-designer/side-panel/block-style-editor.component';
import { BookSeriesService } from 'src/app/common/services/data/library/book-series.service';
import { BreakoutBlockDialogComponent } from 'src/app/events-manager/events/event-agenda/breakout-block-dialog.component';
import { campaignEmailEditorCanDeactivateGuard } from 'src/app/campaigns-manager/campaign-email-editor/campaign-email-editor.guard';
import { CampaignEmailEditorModule } from 'src/app/campaigns-manager/campaign-email-editor/campaign-email-editor.module';
import { CampaignEmailEditorRoutingModule } from 'src/app/campaigns-manager/campaign-email-editor/campaign-email-editor-routing.module';
import { CampaignEmailModel } from 'src/app/common/models/domain/campaign-email.model';
import { CampaignPopupModel } from 'src/app/common/models/domain/campaign-popup.model';
import { CampaignService } from 'src/app/common/services/data/campaign.service';
import { CampaignsManagerModule } from 'src/app/campaigns-manager/campaigns-manager.module';
import { CampaignsManagerRoutingModule } from 'src/app/campaigns-manager/campaigns-manager-routing.module';
import { CategoryModalComponent } from 'src/app/store-manager/product-categories/category-modal/category-modal.component';
import { CoachDialogComponent } from 'src/app/events-manager/coaches/coach-dialog.component';
import { ConfirmDialogComponent } from 'src/app/shared/confirm-dialog/confirm-dialog.component';
import { ConfirmService } from 'src/app/shared/confirm-dialog/confirm.service';
import { ContactDetailsDialogComponent } from 'src/app/contacts-manager/contacts/contact-details-dialog.component';
import { ContactModel } from 'src/app/common/models/domain/utils/contact.model';
import { ContactsManagerModule } from 'src/app/contacts-manager/contacts-manager.module';
import { ContactsManagerRoutingModule } from 'src/app/contacts-manager/contacts-manager-routing.module';
import { ContentManagerModule } from 'src/app/content-manager/content-manager.module';
import { ContentManagerRoutingModule } from 'src/app/content-manager/content-manager-routing.module';
import { CoreModule } from 'src/app/core/core.module';
import { CouponDialogComponent } from 'src/app/store-manager/coupons/coupon-dialog.component';
import { CreateItemDialogComponent } from 'src/app/library-manager/dialogs/create-item-dialog.component';
import { CreateOrgContactDialogComponent } from 'src/app/shared/create-org-contact-dialog/create-org-contact-dialog.component';
import { CustomFormSubmissionDetailDialogComponent } from 'src/app/contacts-manager/custom-form-submissions/custom-form-submission-detail-dialog.component';
import { DailyReadingDialogComponent } from 'src/app/library-manager/lesson-editor/daily-reading-dialog.component';
import { DataGridCellDirective } from 'src/app/shared/data-grid/data-grid-cell.directive';
import { DEFAULT_COLOR_THEME } from 'src/app/common/services/utils/theme.service';
import { describeCampaignDelete } from 'src/app/campaigns-manager/campaigns/campaign-delete-text';
import { DesignerStateService } from 'src/app/tools-manager/email-designer/designer-state.service';
import { DMMDialogComponent } from 'src/app/content-manager/dmms/dmm-dialog.component';
import { EditTierDialogComponent } from 'src/app/library-manager/dialogs/edit-tier-dialog.component';
import { EmailBuilderModule } from 'src/app/tools-manager/email-designer/email-builder.module';
import { emailDesignerCanDeactivateGuard } from 'src/app/tools-manager/email-designer/email-designer.guard';
import { EmailDesignerModule } from 'src/app/tools-manager/email-designer/email-designer.module';
import { EmailDesignerRoutingModule } from 'src/app/tools-manager/email-designer/email-designer-routing.module';
import { ensureLibraryFormioComponentsRegistered } from 'src/app/common/services/data/library/library-formio-registration.util';
import { ensureLibraryVendorStylesheet } from 'src/app/common/services/data/library/library-vendor-stylesheet.util';
import { EventAttendeeDialogComponent } from 'src/app/events-manager/events/event-attendees/event-attendee-dialog.component';
import { EventEmailDialogComponent } from 'src/app/events-manager/events/event-attendees/event-email-dialog.component';
import { EventsManagerModule } from 'src/app/events-manager/events-manager.module';
import { EventsManagerRoutingModule } from 'src/app/events-manager/events-manager-routing.module';
import { FaqDialogComponent } from 'src/app/events-manager/events/event-application/questions-and-answers/faq-dialog.component';
import { FileBrowserStorageService } from 'src/app/shared/image-uploader/file-browser-storage.service';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { FolderPickerDialogComponent } from 'src/app/shared/image-uploader/folder-picker-dialog.component';
import { FormTestSubmitDialogComponent } from 'src/app/tools-manager/form-builder/form-test-submit-dialog.component';
import { getLibraryLanguageOptions } from 'src/app/common/services/data/library/library-language-options.util';
import { HomePageImageDialogComponent } from 'src/app/content-manager/home-page-images/home-page-image-dialog.component';
import { ImageUploaderModule } from 'src/app/shared/image-uploader/image-uploader.module';
import { IMPACT_APPLICATIONS } from 'src/app/common/lists/impact_applications.enum';
import { ImpactDisciplesCommonModule } from 'src/app/common/impactdisciples.common.module';
import { InfiniteScrollDirective } from 'src/app/shared/infinite-scroll.directive';
import { lessonEditorCanDeactivateGuard } from 'src/app/library-manager/lesson-editor/lesson-editor.guard';
import { lessonTemplateEditorCanDeactivateGuard } from 'src/app/library-manager/lesson-template-editor/lesson-template-editor.guard';
import { LIBRARY_ACTIVITY_ACTION_LABELS } from 'src/app/common/models/domain/library/library-activity-log.model';
import { LIBRARY_ISO_639_1_CODES } from 'src/app/common/services/data/library/library-iso-language-codes';
import { LibraryBookModel } from 'src/app/common/models/domain/library/library-book.model';
import { LibraryBookService } from 'src/app/common/services/data/library/library-book.service';
import { LibraryBulkDiscountTierService } from 'src/app/common/services/data/library/library-bulk-discount-tier.service';
import { LibraryCommonTranslationService } from 'src/app/common/services/data/library/library-common-translation.service';
import { LibraryDiscussionGroupService } from 'src/app/common/services/data/library/library-discussion-group.service';
import { LibraryErrorLogService } from 'src/app/common/services/data/library/library-error-log.service';
import { LibraryGrantLicensesDialogComponent } from 'src/app/library-manager/dialogs/library-grant-licenses-dialog.component';
import { libraryHashText } from 'src/app/common/services/data/library/library-hash.util';
import { LibraryImportBookService } from 'src/app/common/services/data/library/library-import-book.service';
import { LibraryLessonImageService } from 'src/app/common/services/data/library/library-lesson-image.service';
import { LibraryLessonModel } from 'src/app/common/models/domain/library/library-lesson.model';
import { LibraryLessonService } from 'src/app/common/services/data/library/library-lesson.service';
import { LibraryLessonTemplateService } from 'src/app/common/services/data/library/library-lesson-template.service';
import { LibraryManagerModule } from 'src/app/library-manager/library-manager.module';
import { LibraryManagerRoutingModule } from 'src/app/library-manager/library-manager-routing.module';
import { LibraryMessageDetailDialogComponent } from 'src/app/library-manager/dialogs/library-message-detail-dialog.component';
import { LibraryPermissionDialogComponent } from 'src/app/library-manager/dialogs/library-permission-dialog.component';
import { LibrarySendMessageDialogComponent } from 'src/app/library-manager/dialogs/library-send-message-dialog.component';
import { LibrarySubtemplateModel } from 'src/app/common/models/domain/library/library-subtemplate.model';
import { LibraryTitleTranslationService } from 'src/app/common/services/data/library/library-title-translation.service';
import { LibraryTranslationService } from 'src/app/common/services/data/library/library-translation.service';
import { LibraryUnitService } from 'src/app/common/services/data/library/library-unit.service';
import { LibraryUserService } from 'src/app/common/services/data/library/library-user.service';
import { ListHeaderComponent } from 'src/app/shared/list-header/list-header.component';
import { LocaleDialogComponent } from 'src/app/library-manager/dialogs/locale-dialog.component';
import { MailTemplateModel } from 'src/app/common/models/admin/mail.model';
import { mergeSubtemplateIntoSchema } from 'src/app/common/services/data/library/library-template-merge.util';
import { NewRecordAlertsService } from 'src/app/common/services/data/new-record-alerts.service';
import { NewRecordTracker } from 'src/app/shared/new-record-tracking.util';
import { normalizeInlineHtml } from 'src/app/tools-manager/email-designer/inline-editor/inline-html.util';
import { notify } from 'src/app/common/utils/notify.util';
import { OrderWorkflowDialogComponent } from 'src/app/shared/order-workflow-dialog/order-workflow-dialog.component';
import { OrganizationLocationDialogComponent } from 'src/app/contacts-manager/organizations/organization-location-dialog.component';
import { PALETTE_PREFIX } from 'src/app/tools-manager/form-builder/field-drop.util';
import { parseBookPath } from 'src/app/common/services/data/library/library-nested-path.util';
import { parseVideoUrl } from 'src/app/tools-manager/email-designer/video-url.util';
import { PermissionMigrationService } from 'src/app/common/services/permission-migration.service';
import { PhoneMaskDirective } from 'src/app/shared/phone-field/phone-mask.directive';
import { PhoneNumberMaskPipe } from 'src/app/common/pipes/phone-number.pipe';
import { PipesModule } from 'src/app/common/pipes/pipes.module';
import { PreviewDialogComponent } from 'src/app/tools-manager/email-designer/preview/preview-dialog.component';
import { PublishWebDialogComponent } from 'src/app/campaigns-manager/campaign-detail/publish-web-dialog.component';
import { QUILL_SIZE_WHITELIST } from 'src/app/shared/rich-text-editor/quill-style-attributors';
import { RefundDialogComponent } from 'src/app/contacts-manager/purchase-details/refund-dialog.component';
import { RenameDialogComponent } from 'src/app/shared/image-uploader/rename-dialog.component';
import { ReportsManagerModule } from 'src/app/reports-manager/reports-manager.module';
import { ReportsManagerRoutingModule } from 'src/app/reports-manager/reports-manager-routing.module';
import { RICH_TEXT_TOOLBAR } from 'src/app/shared/rich-text-editor/quill-toolbar.config';
import { RoomDialogComponent } from 'src/app/events-manager/events/room/room-dialog.component';
import { RouteRequestDialogComponent } from 'src/app/shared/route-request-dialog/route-request-dialog.component';
import { SaveAsTemplateDialogComponent } from 'src/app/campaigns-manager/campaign-email-editor/save-as-template-dialog.component';
import { ScreenPermissionsDialogComponent } from 'src/app/core/main-screen/screen-permissions-dialog/screen-permissions-dialog.component';
import { ScreenService } from 'src/app/common/services/utils/screen.service';
import { SendSubscriptionDialogComponent } from 'src/app/reports-manager/subscriber-report/send-subscription-dialog.component';
import { SendTestDialogComponent } from 'src/app/tools-manager/email-designer/preview/send-test-dialog.component';
import { SentEmailPreviewDialogComponent } from 'src/app/campaigns-manager/sent-emails/sent-email-preview-dialog.component';
import { SeriesModalComponent } from 'src/app/store-manager/product-series/series-modal/series-modal.component';
import { SharedModule } from 'src/app/shared/shared.module';
import { ShippingLabelDialogComponent } from 'src/app/tools-manager/shipping-labels/shipping-label-dialog.component';
import { SnackbarService } from 'src/app/shared/snackbar.service';
import { StoreManagerModule } from 'src/app/store-manager/store-manager.module';
import { StoreManagerRoutingModule } from 'src/app/store-manager/store-manager-routing.module';
import { SubscriberDialogComponent } from 'src/app/reports-manager/subscriber-report/subscriber-dialog.component';
import { SubtemplateCreateDialogComponent } from 'src/app/library-manager/subtemplates/subtemplate-create-dialog.component';
import { subtemplateEditorCanDeactivateGuard } from 'src/app/library-manager/subtemplate-editor/subtemplate-editor.guard';
import { SummitPreviewComponent } from 'src/app/events-manager/events/summit-preview/summit-preview.component';
import { TagApplicationModel } from 'src/app/common/services/data/tag-application.service';
import { TagRuleModel } from 'src/app/common/models/domain/tag-rule.model';
import { TagRuleService } from 'src/app/common/services/data/tag-rule.service';
import { TeamPageDialogComponent } from 'src/app/content-manager/team-page/team-page-dialog.component';
import { TemplatePickerDialogComponent } from 'src/app/tools-manager/email-designer/template-picker/template-picker-dialog.component';
import { TestimonialDialogComponent } from 'src/app/content-manager/testimonials/testimonial-dialog.component';
import { ToolsManagerModule } from 'src/app/tools-manager/tools-manager.module';
import { ToolsManagerRoutingModule } from 'src/app/tools-manager/tools-manager-routing.module';

// The last breadth pass (2026-08-22): NgModules, guards, directives, pipes,
// config objects and the remaining injectables - everything the service,
// model and component bulk specs did not already reach.
//
// Two tiers, and the difference is deliberate:
//   - injectables are CONSTRUCTED, which runs their constructor and field
//     initializers
//   - everything else is asserted LOADABLE, which is worth more than it
//     sounds: an NgModule that cannot be imported means a circular
//     dependency or a missing declaration, and that is a real break this
//     catches at the cheapest possible price.
//
// Nothing here renders a template. This is a floor, not a substitute for
// the real specs these files deserve.

const PROVIDERS = [
  { provide: Firestore, useValue: {} },
  { provide: Auth, useValue: { onAuthStateChanged: () => () => undefined, currentUser: null } },
  { provide: Functions, useValue: {} },
  { provide: Storage, useValue: {} },
  { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => ({ subscribe: () => undefined }) }) } },
  { provide: MatDialogRef, useValue: { close: () => undefined } },
  { provide: MAT_DIALOG_DATA, useValue: {} },
  { provide: MatSnackBar, useValue: { open: () => undefined } },
  { provide: Router, useValue: { navigate: () => Promise.resolve(true), url: '/' } },
  {
    provide: ActivatedRoute,
    useValue: {
      snapshot: { paramMap: { get: () => null }, queryParamMap: { get: () => null }, params: {}, data: {} },
      paramMap: { pipe: () => ({ subscribe: () => undefined }), subscribe: () => undefined },
      queryParamMap: { pipe: () => ({ subscribe: () => undefined }), subscribe: () => undefined },
    },
  },
  FormBuilder,
];

const INJECTABLES: { name: string; type: Type<unknown> }[] = [
  { name: 'AdminAuthService', type: AdminAuthService },
  { name: 'AdminUserService', type: AdminUserService },
  { name: 'BookSeriesService', type: BookSeriesService },
  { name: 'CampaignService', type: CampaignService },
  { name: 'ConfirmService', type: ConfirmService },
  { name: 'DesignerStateService', type: DesignerStateService },
  { name: 'FirebaseDAO', type: FirebaseDAO },
  { name: 'LibraryBookService', type: LibraryBookService },
  { name: 'LibraryBulkDiscountTierService', type: LibraryBulkDiscountTierService },
  { name: 'LibraryCommonTranslationService', type: LibraryCommonTranslationService },
  { name: 'LibraryDiscussionGroupService', type: LibraryDiscussionGroupService },
  { name: 'LibraryErrorLogService', type: LibraryErrorLogService },
  { name: 'LibraryImportBookService', type: LibraryImportBookService },
  { name: 'LibraryLessonImageService', type: LibraryLessonImageService },
  { name: 'LibraryLessonService', type: LibraryLessonService },
  { name: 'LibraryLessonTemplateService', type: LibraryLessonTemplateService },
  { name: 'LibraryTitleTranslationService', type: LibraryTitleTranslationService },
  { name: 'LibraryTranslationService', type: LibraryTranslationService },
  { name: 'LibraryUnitService', type: LibraryUnitService },
  { name: 'PermissionMigrationService', type: PermissionMigrationService },
  { name: 'ScreenService', type: ScreenService },
  { name: 'SnackbarService', type: SnackbarService },
  { name: 'TagApplicationModel', type: TagApplicationModel },
  { name: 'TagRuleService', type: TagRuleService },
];

const LOADABLE: { name: string; value: unknown }[] = [
  { name: 'AddContactNoteDialogComponent', value: AddContactNoteDialogComponent },
  { name: 'AdminManagerModule', value: AdminManagerModule },
  { name: 'AdminManagerRoutingModule', value: AdminManagerRoutingModule },
  { name: 'AgendaItemDialogComponent', value: AgendaItemDialogComponent },
  { name: 'AmazonConfirmationDialogComponent', value: AmazonConfirmationDialogComponent },
  { name: 'AppModule', value: AppModule },
  { name: 'AppRoutingModule', value: AppRoutingModule },
  { name: 'assembleLibraryLessonSchema', value: assembleLibraryLessonSchema },
  { name: 'AuthModule', value: AuthModule },
  { name: 'BLOCK_PALETTE_ID', value: BLOCK_PALETTE_ID },
  { name: 'BlockStyleEditorComponent', value: BlockStyleEditorComponent },
  { name: 'BreakoutBlockDialogComponent', value: BreakoutBlockDialogComponent },
  { name: 'campaignEmailEditorCanDeactivateGuard', value: campaignEmailEditorCanDeactivateGuard },
  { name: 'CampaignEmailEditorModule', value: CampaignEmailEditorModule },
  { name: 'CampaignEmailEditorRoutingModule', value: CampaignEmailEditorRoutingModule },
  { name: 'CampaignEmailModel', value: CampaignEmailModel },
  { name: 'CampaignPopupModel', value: CampaignPopupModel },
  { name: 'CampaignsManagerModule', value: CampaignsManagerModule },
  { name: 'CampaignsManagerRoutingModule', value: CampaignsManagerRoutingModule },
  { name: 'CategoryModalComponent', value: CategoryModalComponent },
  { name: 'CoachDialogComponent', value: CoachDialogComponent },
  { name: 'ConfirmDialogComponent', value: ConfirmDialogComponent },
  { name: 'ContactDetailsDialogComponent', value: ContactDetailsDialogComponent },
  { name: 'ContactModel', value: ContactModel },
  { name: 'ContactsManagerModule', value: ContactsManagerModule },
  { name: 'ContactsManagerRoutingModule', value: ContactsManagerRoutingModule },
  { name: 'ContentManagerModule', value: ContentManagerModule },
  { name: 'ContentManagerRoutingModule', value: ContentManagerRoutingModule },
  { name: 'CoreModule', value: CoreModule },
  { name: 'CouponDialogComponent', value: CouponDialogComponent },
  { name: 'CreateItemDialogComponent', value: CreateItemDialogComponent },
  { name: 'CreateOrgContactDialogComponent', value: CreateOrgContactDialogComponent },
  { name: 'CustomFormSubmissionDetailDialogComponent', value: CustomFormSubmissionDetailDialogComponent },
  { name: 'DailyReadingDialogComponent', value: DailyReadingDialogComponent },
  { name: 'DataGridCellDirective', value: DataGridCellDirective },
  { name: 'DEFAULT_COLOR_THEME', value: DEFAULT_COLOR_THEME },
  { name: 'describeCampaignDelete', value: describeCampaignDelete },
  { name: 'DMMDialogComponent', value: DMMDialogComponent },
  { name: 'EditTierDialogComponent', value: EditTierDialogComponent },
  { name: 'EmailBuilderModule', value: EmailBuilderModule },
  { name: 'emailDesignerCanDeactivateGuard', value: emailDesignerCanDeactivateGuard },
  { name: 'EmailDesignerModule', value: EmailDesignerModule },
  { name: 'EmailDesignerRoutingModule', value: EmailDesignerRoutingModule },
  { name: 'ensureLibraryFormioComponentsRegistered', value: ensureLibraryFormioComponentsRegistered },
  { name: 'ensureLibraryVendorStylesheet', value: ensureLibraryVendorStylesheet },
  { name: 'EventAttendeeDialogComponent', value: EventAttendeeDialogComponent },
  { name: 'EventEmailDialogComponent', value: EventEmailDialogComponent },
  { name: 'EventsManagerModule', value: EventsManagerModule },
  { name: 'EventsManagerRoutingModule', value: EventsManagerRoutingModule },
  { name: 'FaqDialogComponent', value: FaqDialogComponent },
  { name: 'FileBrowserStorageService', value: FileBrowserStorageService },
  { name: 'FolderPickerDialogComponent', value: FolderPickerDialogComponent },
  { name: 'FormTestSubmitDialogComponent', value: FormTestSubmitDialogComponent },
  { name: 'getLibraryLanguageOptions', value: getLibraryLanguageOptions },
  { name: 'HomePageImageDialogComponent', value: HomePageImageDialogComponent },
  { name: 'ImageUploaderModule', value: ImageUploaderModule },
  { name: 'IMPACT_APPLICATIONS', value: IMPACT_APPLICATIONS },
  { name: 'ImpactDisciplesCommonModule', value: ImpactDisciplesCommonModule },
  { name: 'InfiniteScrollDirective', value: InfiniteScrollDirective },
  { name: 'lessonEditorCanDeactivateGuard', value: lessonEditorCanDeactivateGuard },
  { name: 'lessonTemplateEditorCanDeactivateGuard', value: lessonTemplateEditorCanDeactivateGuard },
  { name: 'LIBRARY_ACTIVITY_ACTION_LABELS', value: LIBRARY_ACTIVITY_ACTION_LABELS },
  { name: 'LIBRARY_ISO_639_1_CODES', value: LIBRARY_ISO_639_1_CODES },
  { name: 'LibraryBookModel', value: LibraryBookModel },
  { name: 'LibraryGrantLicensesDialogComponent', value: LibraryGrantLicensesDialogComponent },
  { name: 'libraryHashText', value: libraryHashText },
  { name: 'LibraryLessonModel', value: LibraryLessonModel },
  { name: 'LibraryManagerModule', value: LibraryManagerModule },
  { name: 'LibraryManagerRoutingModule', value: LibraryManagerRoutingModule },
  { name: 'LibraryMessageDetailDialogComponent', value: LibraryMessageDetailDialogComponent },
  { name: 'LibraryPermissionDialogComponent', value: LibraryPermissionDialogComponent },
  { name: 'LibrarySendMessageDialogComponent', value: LibrarySendMessageDialogComponent },
  { name: 'LibrarySubtemplateModel', value: LibrarySubtemplateModel },
  { name: 'LibraryUserService', value: LibraryUserService },
  { name: 'ListHeaderComponent', value: ListHeaderComponent },
  { name: 'LocaleDialogComponent', value: LocaleDialogComponent },
  { name: 'MailTemplateModel', value: MailTemplateModel },
  { name: 'mergeSubtemplateIntoSchema', value: mergeSubtemplateIntoSchema },
  { name: 'NewRecordAlertsService', value: NewRecordAlertsService },
  { name: 'NewRecordTracker', value: NewRecordTracker },
  { name: 'normalizeInlineHtml', value: normalizeInlineHtml },
  { name: 'notify', value: notify },
  { name: 'OrderWorkflowDialogComponent', value: OrderWorkflowDialogComponent },
  { name: 'OrganizationLocationDialogComponent', value: OrganizationLocationDialogComponent },
  { name: 'PALETTE_PREFIX', value: PALETTE_PREFIX },
  { name: 'parseBookPath', value: parseBookPath },
  { name: 'parseVideoUrl', value: parseVideoUrl },
  { name: 'PhoneMaskDirective', value: PhoneMaskDirective },
  { name: 'PhoneNumberMaskPipe', value: PhoneNumberMaskPipe },
  { name: 'PipesModule', value: PipesModule },
  { name: 'PreviewDialogComponent', value: PreviewDialogComponent },
  { name: 'PublishWebDialogComponent', value: PublishWebDialogComponent },
  { name: 'QUILL_SIZE_WHITELIST', value: QUILL_SIZE_WHITELIST },
  { name: 'RefundDialogComponent', value: RefundDialogComponent },
  { name: 'RenameDialogComponent', value: RenameDialogComponent },
  { name: 'ReportsManagerModule', value: ReportsManagerModule },
  { name: 'ReportsManagerRoutingModule', value: ReportsManagerRoutingModule },
  { name: 'RICH_TEXT_TOOLBAR', value: RICH_TEXT_TOOLBAR },
  { name: 'RoomDialogComponent', value: RoomDialogComponent },
  { name: 'RouteRequestDialogComponent', value: RouteRequestDialogComponent },
  { name: 'SaveAsTemplateDialogComponent', value: SaveAsTemplateDialogComponent },
  { name: 'ScreenPermissionsDialogComponent', value: ScreenPermissionsDialogComponent },
  { name: 'SendSubscriptionDialogComponent', value: SendSubscriptionDialogComponent },
  { name: 'SendTestDialogComponent', value: SendTestDialogComponent },
  { name: 'SentEmailPreviewDialogComponent', value: SentEmailPreviewDialogComponent },
  { name: 'SeriesModalComponent', value: SeriesModalComponent },
  { name: 'SharedModule', value: SharedModule },
  { name: 'ShippingLabelDialogComponent', value: ShippingLabelDialogComponent },
  { name: 'StoreManagerModule', value: StoreManagerModule },
  { name: 'StoreManagerRoutingModule', value: StoreManagerRoutingModule },
  { name: 'SubscriberDialogComponent', value: SubscriberDialogComponent },
  { name: 'SubtemplateCreateDialogComponent', value: SubtemplateCreateDialogComponent },
  { name: 'subtemplateEditorCanDeactivateGuard', value: subtemplateEditorCanDeactivateGuard },
  { name: 'SummitPreviewComponent', value: SummitPreviewComponent },
  { name: 'TagRuleModel', value: TagRuleModel },
  { name: 'TeamPageDialogComponent', value: TeamPageDialogComponent },
  { name: 'TemplatePickerDialogComponent', value: TemplatePickerDialogComponent },
  { name: 'TestimonialDialogComponent', value: TestimonialDialogComponent },
  { name: 'ToolsManagerModule', value: ToolsManagerModule },
  { name: 'ToolsManagerRoutingModule', value: ToolsManagerRoutingModule },
];

describe('modules, guards and remaining providers - smoke', () => {
  afterEach(() => TestBed.resetTestingModule());

  for (const { name, type } of INJECTABLES) {
    it(`${name} constructs`, () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [type, ...PROVIDERS] });
      expect(TestBed.inject(type)).toBeTruthy();
    });
  }

  for (const { name, value } of LOADABLE) {
    it(`${name} loads`, () => {
      expect(value).toBeDefined();
    });
  }

  it('names everything exactly once', () => {
    const names = [...INJECTABLES.map((i) => i.name), ...LOADABLE.map((l) => l.name)];
    expect(new Set(names).size).toBe(names.length);
  });
});
