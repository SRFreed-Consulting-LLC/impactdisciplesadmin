import { Type } from '@angular/core';
import { of } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { Storage } from '@angular/fire/storage';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { AddContactNoteDialogComponent } from 'src/app/contacts-manager/contacts/add-contact-note-dialog.component';
import { AddressFieldComponent } from 'src/app/shared/address-field/address-field.component';
import { AdminManagerComponent } from 'src/app/admin-manager/admin-manager.component';
import { AdminUsersComponent } from 'src/app/admin-manager/admin-users/admin-users.component';
import { AffiliateSalesComponent } from 'src/app/store-manager/affiliate-sales/affiliate-sales.component';
import { AgendaCanvasComponent } from 'src/app/events-manager/events/event-agenda/agenda-canvas/agenda-canvas.component';
import { AgendaGridComponent } from 'src/app/events-manager/events/event-agenda/agenda-grid/agenda-grid.component';
import { AgendaItemDialogComponent } from 'src/app/events-manager/events/event-agenda/agenda-item-dialog.component';
import { AgendaWizardComponent } from 'src/app/events-manager/events/event-agenda/agenda-wizard/agenda-wizard.component';
import { AmazonConfirmationDialogComponent } from 'src/app/shared/amazon-confirmation-dialog/amazon-confirmation-dialog.component';
import { AnimatedLogoComponent } from 'src/app/common/forms/admin/login/animated-logo.component';
import { AppComponent } from 'src/app/app.component';
import { AuthCardComponent } from 'src/app/core/auth/auth-card/auth-card.component';
import { BlockHostComponent } from 'src/app/tools-manager/email-designer/canvas/block-host.component';
import { BlockStyleEditorComponent } from 'src/app/tools-manager/email-designer/side-panel/block-style-editor.component';
import { BreakoutBlockDialogComponent } from 'src/app/events-manager/events/event-agenda/breakout-block-dialog.component';
import { CampaignDetailComponent } from 'src/app/campaigns-manager/campaign-detail/campaign-detail.component';
import { CampaignsManagerComponent } from 'src/app/campaigns-manager/campaigns-manager.component';
import { CampaignWizardComponent } from 'src/app/campaigns-manager/campaign-wizard/campaign-wizard.component';
import { CategoryModalComponent } from 'src/app/data-manager/product-categories/category-modal/category-modal.component';
import { CoachDialogComponent } from 'src/app/events-manager/coaches/coach-dialog.component';
import { CoachesComponent } from 'src/app/events-manager/coaches/coaches.component';
import { CoachQuickCreateDialogComponent } from 'src/app/events-manager/events/event-agenda/coach-quick-create-dialog.component';
import { ColumnFilterComponent } from 'src/app/shared/data-grid/column-filter/column-filter.component';
import { ConfirmDialogComponent } from 'src/app/shared/confirm-dialog/confirm-dialog.component';
import { ContactDetailsDialogComponent } from 'src/app/contacts-manager/contacts/contact-details-dialog.component';
import { ContactReportComponent } from 'src/app/reports-manager/contact-report/contact-report.component';
import { ContactsComponent } from 'src/app/contacts-manager/contacts/contacts.component';
import { ContactsManagerComponent } from 'src/app/contacts-manager/contacts-manager.component';
import { PageManagerComponent } from 'src/app/page-manager/page-manager.component';
import { CouponDialogComponent } from 'src/app/store-manager/coupons/coupon-dialog.component';
import { CouponsComponent } from 'src/app/store-manager/coupons/coupons.component';
import { CreateItemDialogComponent } from 'src/app/library-manager/dialogs/create-item-dialog.component';
import { CreateOrgContactDialogComponent } from 'src/app/shared/create-org-contact-dialog/create-org-contact-dialog.component';
import { CustomFormSubmissionDetailDialogComponent } from 'src/app/data-manager/custom-form-submissions/custom-form-submission-detail-dialog.component';
import { CustomFormSubmissionsComponent } from 'src/app/data-manager/custom-form-submissions/custom-form-submissions.component';
import { DailyReadingDialogComponent } from 'src/app/library-manager/lesson-editor/daily-reading-dialog.component';
import { DashboardComponent } from 'src/app/core/dashboard/dashboard.component';
import { DateTimeFieldComponent } from 'src/app/shared/date-time-field/date-time-field.component';
import { DesignCanvasComponent } from 'src/app/tools-manager/email-designer/canvas/design-canvas.component';
import { DMMDialogComponent } from 'src/app/data-manager/dmms/dmm-dialog.component';
import { DMMServiceComponent } from 'src/app/data-manager/dmms/dmms.component';
import { EditTierDialogComponent } from 'src/app/library-manager/dialogs/edit-tier-dialog.component';
import { EmailDesignerComponent } from 'src/app/tools-manager/email-designer/email-designer.component';
import { EventAgendaComponent } from 'src/app/events-manager/events/event-agenda/event-agenda.component';
import { EventApplicationComponent } from 'src/app/events-manager/events/event-application/event-application.component';
import { EventAttendeeDialogComponent } from 'src/app/events-manager/events/event-attendees/event-attendee-dialog.component';
import { EventAttendeesComponent } from 'src/app/events-manager/events/event-attendees/event-attendees.component';
import { EventEmailDialogComponent } from 'src/app/events-manager/events/event-attendees/event-email-dialog.component';
import { EventReportComponent } from 'src/app/reports-manager/event-report/event-report.component';
import { EventsManagerComponent } from 'src/app/events-manager/events-manager.component';
import { FAQComponent } from 'src/app/events-manager/events/event-application/questions-and-answers/faq.component';
import { FaqDialogComponent } from 'src/app/events-manager/events/event-application/questions-and-answers/faq-dialog.component';
import { FileTreeNodeComponent } from 'src/app/shared/image-uploader/file-tree-node.component';
import { FolderPickerDialogComponent } from 'src/app/shared/image-uploader/folder-picker-dialog.component';
import { FormBuilderComponent } from 'src/app/data-manager/form-builder/form-builder.component';
import { FormFieldSettingsComponent } from 'src/app/data-manager/form-builder/form-field-settings.component';
import { FormRendererComponent } from 'src/app/shared/form-renderer/form-renderer.component';
import { FormRendererFieldComponent } from 'src/app/shared/form-renderer/form-renderer-field.component';
import { FormTestSubmitDialogComponent } from 'src/app/data-manager/form-builder/form-test-submit-dialog.component';
import { FulfillmentComponent } from 'src/app/contacts-manager/fulfillment/fulfillment.component';
import { GlobalStylesPanelComponent } from 'src/app/tools-manager/email-designer/side-panel/global-styles-panel.component';
import { ImportBookDialogComponent } from 'src/app/library-manager/dialogs/import-book-dialog.component';
import { IndicatorButtonComponent } from 'src/app/shared/indicator-button/indicator-button.component';
import { InlineTextEditorComponent } from 'src/app/tools-manager/email-designer/inline-editor/inline-text-editor.component';
import { LessonEditorComponent } from 'src/app/library-manager/lesson-editor/lesson-editor.component';
import { LessonPreviewComponent } from 'src/app/library-manager/lesson-preview/lesson-preview.component';
import { LessonTemplateEditorComponent } from 'src/app/library-manager/lesson-template-editor/lesson-template-editor.component';
import { LessonTranslationComponent } from 'src/app/library-manager/lesson-translation/lesson-translation.component';
import { LibraryBrowseComponent } from 'src/app/library-manager/browse/library-browse.component';
import { LibraryGrantLicensesDialogComponent } from 'src/app/library-manager/dialogs/library-grant-licenses-dialog.component';
import { LibraryManagerComponent } from 'src/app/library-manager/library-manager.component';
import { LibraryMessageDetailDialogComponent } from 'src/app/library-manager/dialogs/library-message-detail-dialog.component';
import { LibraryPermissionDialogComponent } from 'src/app/library-manager/dialogs/library-permission-dialog.component';
import { LibrarySendMessageDialogComponent } from 'src/app/library-manager/dialogs/library-send-message-dialog.component';
import { ListHeaderComponent } from 'src/app/shared/list-header/list-header.component';
import { LocaleDialogComponent } from 'src/app/library-manager/dialogs/locale-dialog.component';
import { LoginComponent } from 'src/app/common/forms/admin/login/login.component';
import { LogMessagesComponent } from 'src/app/admin-manager/log-messages/log-messages.component';
import { MainScreenComponent } from 'src/app/core/main-screen/main-screen.component';
import { NewFolderDialogComponent } from 'src/app/shared/image-uploader/new-folder-dialog.component';
import { NewRecordAlertsComponent } from 'src/app/shared/new-record-alerts/new-record-alerts.component';
import { OrderWorkflowDialogComponent } from 'src/app/shared/order-workflow-dialog/order-workflow-dialog.component';
import { OrganizationDetailsComponent } from 'src/app/contacts-manager/organizations/organization-details.component';
import { OrganizationLocationDialogComponent } from 'src/app/contacts-manager/organizations/organization-location-dialog.component';
import { OrganizationsComponent } from 'src/app/contacts-manager/organizations/organizations.component';
import { PagedTableFooterComponent } from 'src/app/shared/data-grid/paged-table-footer/paged-table-footer.component';
import { PhoneFieldComponent } from 'src/app/shared/phone-field/phone-field.component';
import { PopupEditorComponent } from 'src/app/campaigns-manager/popup-editor/popup-editor.component';
import { PopupHeaderComponent } from 'src/app/shared/popup-header/popup-header.component';
import { PreviewDialogComponent } from 'src/app/tools-manager/email-designer/preview/preview-dialog.component';
import { ProductCategoriesComponent } from 'src/app/data-manager/product-categories/product-categories.component';
import { ProductsComponent } from 'src/app/data-manager/products/products.component';
import { ProductSeriesComponent } from 'src/app/data-manager/product-series/product-series.component';
import { PublishWebDialogComponent } from 'src/app/campaigns-manager/campaign-detail/publish-web-dialog.component';
import { PurchasesComponent } from 'src/app/contacts-manager/purchases/purchases.component';
import { RefundDialogComponent } from 'src/app/contacts-manager/purchase-details/refund-dialog.component';
import { RenameDialogComponent } from 'src/app/shared/image-uploader/rename-dialog.component';
import { ReportsManagerComponent } from 'src/app/reports-manager/reports-manager.component';
import { ResetPasswordComponent } from 'src/app/core/auth/reset-password/reset-password.component';
import { RoomComponent } from 'src/app/events-manager/events/room/room.component';
import { RoomDialogComponent } from 'src/app/events-manager/events/room/room-dialog.component';
import { RouteRequestDialogComponent } from 'src/app/shared/route-request-dialog/route-request-dialog.component';
import { SaveAsTemplateDialogComponent } from 'src/app/campaigns-manager/campaign-email-editor/save-as-template-dialog.component';
import { ScreenPermissionsDialogComponent } from 'src/app/core/main-screen/screen-permissions-dialog/screen-permissions-dialog.component';
import { SendSubscriptionDialogComponent } from 'src/app/reports-manager/subscriber-report/send-subscription-dialog.component';
import { SendTestDialogComponent } from 'src/app/tools-manager/email-designer/preview/send-test-dialog.component';
import { SentEmailPreviewDialogComponent } from 'src/app/campaigns-manager/sent-emails/sent-email-preview-dialog.component';
import { SentEmailsComponent } from 'src/app/campaigns-manager/sent-emails/sent-emails.component';
import { SeriesModalComponent } from 'src/app/data-manager/product-series/series-modal/series-modal.component';
import { ShippingLabelDialogComponent } from 'src/app/tools-manager/shipping-labels/shipping-label-dialog.component';
import { ShippingLabelsComponent } from 'src/app/tools-manager/shipping-labels/shipping-labels.component';
import { SocialComposerComponent } from 'src/app/campaigns-manager/social-composer/social-composer.component';
import { StatusBoardComponent } from 'src/app/campaigns-manager/status-board/status-board.component';
import { StoreManagerComponent } from 'src/app/store-manager/store-manager.component';
import { SubscriberDialogComponent } from 'src/app/reports-manager/subscriber-report/subscriber-dialog.component';
import { SubscriberReportComponent } from 'src/app/reports-manager/subscriber-report/subscriber-report.component';
import { SubtemplateCreateDialogComponent } from 'src/app/library-manager/subtemplates/subtemplate-create-dialog.component';
import { SubtemplateEditorComponent } from 'src/app/library-manager/subtemplate-editor/subtemplate-editor.component';
import { SummitPreviewComponent } from 'src/app/events-manager/events/summit-preview/summit-preview.component';
import { SummitPreviewRailComponent } from 'src/app/events-manager/events/summit-preview-rail/summit-preview-rail.component';
import { SummitSetupWizardComponent } from 'src/app/events-manager/events/summit-setup-wizard/summit-setup-wizard.component';
import { TableLoadingOverlayComponent } from 'src/app/shared/data-grid/table-loading-overlay/table-loading-overlay.component';
import { TagChipsComponent } from 'src/app/shared/tag-chips/tag-chips.component';
import { TagRulesComponent } from 'src/app/campaigns-manager/tag-rules/tag-rules.component';
import { TeamPageComponent } from 'src/app/data-manager/team-page/team-page.component';
import { TeamPageDialogComponent } from 'src/app/data-manager/team-page/team-page-dialog.component';
import { TemplatePickerDialogComponent } from 'src/app/tools-manager/email-designer/template-picker/template-picker-dialog.component';
import { TestimonialDialogComponent } from 'src/app/data-manager/testimonials/testimonial-dialog.component';
import { TestimonialsComponent } from 'src/app/data-manager/testimonials/testimonials.component';
import { ThemesComponent } from 'src/app/core/settings/themes.component';
import { ToolsManagerComponent } from 'src/app/tools-manager/tools-manager.component';
import { VariableInserterComponent } from 'src/app/shared/rich-text-editor/variable-inserter.component';
import { VenueRoomsDialogComponent } from 'src/app/events-manager/events/venue-rooms-dialog.component';
import { WebConfigComponent } from 'src/app/page-manager/web-config/web-config.component';
import { WebNewslettersComponent } from 'src/app/campaigns-manager/web-newsletters/web-newsletters.component';
import { WorldMapComponent } from 'src/app/library-manager/world-map/world-map.component';

// Breadth pass (2026-08-22): construct every component whose dependencies
// are few enough to stand up cheaply.
//
// TestBed as an INJECTOR only - no compileComponents, no createComponent,
// nothing rendered. That matters for what this does and does not prove:
// constructing a component runs its constructor AND its field
// initializers, which is where defaults, form groups and column
// definitions are built. It does not touch the template.
//
// So this is a real smoke test, not a coverage stunt: it catches a
// component that cannot be built at all - a missing provider, a field
// initializer that throws, a circular import - which is exactly the class
// of breakage a module or DI refactor causes and which no other layer
// here would see until the screen is opened by hand.
//
// The shared provider pool below is deliberately generous. An unused
// provider costs nothing, and one pool keeps this file from becoming 67
// bespoke setups.

// A DAO shaped like the real one. Components inject SERVICES, and those
// services are real classes that call straight through to the DAO - so a
// bare {} here makes every stream method return undefined, and any
// ngOnInit doing combineLatest over them throws asynchronously, after the
// suite has already reported green.
const daoStub = {
  getAll: () => Promise.resolve([]),
  getAllByValue: () => Promise.resolve([]),
  queryAllByMultiValue: () => Promise.resolve([]),
  getById: () => Promise.resolve(null),
  getPage: () => Promise.resolve({ items: [], cursor: null, hasMore: false }),
  streamAll: () => of([]),
  streamAllOrdered: () => of([]),
  streamByValue: () => of([]),
  queryStreamByValue: () => of([]),
  streamById: () => () => undefined,
  add: () => Promise.resolve({}),
  update: () => Promise.resolve({}),
  updateFields: () => Promise.resolve(),
  delete: () => Promise.resolve(),
};

const PROVIDERS = [
  { provide: FirebaseDAO, useValue: daoStub },
  { provide: Firestore, useValue: {} },
  // FireAuthDao subscribes to onAuthStateChanged the moment it is built,
  // via fromEventPattern - a bare {} here throws asynchronously, after the
  // suite has already reported green. Returns an unsubscribe function, as
  // the real API does.
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

interface ComponentRow {
  name: string;
  type: Type<unknown>;
}

const CONSTRUCTIBLE: ComponentRow[] = [
  { name: 'AddContactNoteDialogComponent', type: AddContactNoteDialogComponent },
  { name: 'AddressFieldComponent', type: AddressFieldComponent },
  { name: 'AdminManagerComponent', type: AdminManagerComponent },
  { name: 'AdminUsersComponent', type: AdminUsersComponent },
  { name: 'AffiliateSalesComponent', type: AffiliateSalesComponent },
  { name: 'AgendaCanvasComponent', type: AgendaCanvasComponent },
  { name: 'AgendaGridComponent', type: AgendaGridComponent },
  { name: 'AgendaItemDialogComponent', type: AgendaItemDialogComponent },
  { name: 'AgendaWizardComponent', type: AgendaWizardComponent },
  { name: 'AmazonConfirmationDialogComponent', type: AmazonConfirmationDialogComponent },
  { name: 'AnimatedLogoComponent', type: AnimatedLogoComponent },
  { name: 'AuthCardComponent', type: AuthCardComponent },
  { name: 'CampaignDetailComponent', type: CampaignDetailComponent },
  { name: 'CampaignsManagerComponent', type: CampaignsManagerComponent },
  { name: 'CampaignWizardComponent', type: CampaignWizardComponent },
  { name: 'CategoryModalComponent', type: CategoryModalComponent },
  { name: 'CoachesComponent', type: CoachesComponent },
  { name: 'CoachQuickCreateDialogComponent', type: CoachQuickCreateDialogComponent },
  { name: 'ColumnFilterComponent', type: ColumnFilterComponent },
  { name: 'ConfirmDialogComponent', type: ConfirmDialogComponent },
  { name: 'ContactDetailsDialogComponent', type: ContactDetailsDialogComponent },
  { name: 'ContactReportComponent', type: ContactReportComponent },
  { name: 'ContactsComponent', type: ContactsComponent },
  { name: 'ContactsManagerComponent', type: ContactsManagerComponent },
  { name: 'PageManagerComponent', type: PageManagerComponent },
  { name: 'CouponDialogComponent', type: CouponDialogComponent },
  { name: 'CouponsComponent', type: CouponsComponent },
  { name: 'CreateItemDialogComponent', type: CreateItemDialogComponent },
  { name: 'CustomFormSubmissionsComponent', type: CustomFormSubmissionsComponent },
  { name: 'DashboardComponent', type: DashboardComponent },
  { name: 'DateTimeFieldComponent', type: DateTimeFieldComponent },
  { name: 'DMMDialogComponent', type: DMMDialogComponent },
  { name: 'DMMServiceComponent', type: DMMServiceComponent },
  { name: 'EditTierDialogComponent', type: EditTierDialogComponent },
  { name: 'EventAgendaComponent', type: EventAgendaComponent },
  { name: 'EventApplicationComponent', type: EventApplicationComponent },
  { name: 'EventAttendeeDialogComponent', type: EventAttendeeDialogComponent },
  { name: 'EventAttendeesComponent', type: EventAttendeesComponent },
  { name: 'EventEmailDialogComponent', type: EventEmailDialogComponent },
  { name: 'EventReportComponent', type: EventReportComponent },
  { name: 'EventsManagerComponent', type: EventsManagerComponent },
  { name: 'FAQComponent', type: FAQComponent },
  { name: 'FaqDialogComponent', type: FaqDialogComponent },
  { name: 'FormBuilderComponent', type: FormBuilderComponent },
  { name: 'FormFieldSettingsComponent', type: FormFieldSettingsComponent },
  { name: 'FormRendererComponent', type: FormRendererComponent },
  { name: 'FormRendererFieldComponent', type: FormRendererFieldComponent },
  { name: 'FormTestSubmitDialogComponent', type: FormTestSubmitDialogComponent },
  { name: 'FulfillmentComponent', type: FulfillmentComponent },
  { name: 'ImportBookDialogComponent', type: ImportBookDialogComponent },
  { name: 'IndicatorButtonComponent', type: IndicatorButtonComponent },
  { name: 'LessonEditorComponent', type: LessonEditorComponent },
  { name: 'LessonPreviewComponent', type: LessonPreviewComponent },
  { name: 'LessonTemplateEditorComponent', type: LessonTemplateEditorComponent },
  { name: 'LessonTranslationComponent', type: LessonTranslationComponent },
  { name: 'LibraryBrowseComponent', type: LibraryBrowseComponent },
  { name: 'LibraryManagerComponent', type: LibraryManagerComponent },
  { name: 'LibraryMessageDetailDialogComponent', type: LibraryMessageDetailDialogComponent },
  { name: 'ListHeaderComponent', type: ListHeaderComponent },
  { name: 'LocaleDialogComponent', type: LocaleDialogComponent },
  { name: 'LoginComponent', type: LoginComponent },
  { name: 'LogMessagesComponent', type: LogMessagesComponent },
  { name: 'MainScreenComponent', type: MainScreenComponent },
  { name: 'NewFolderDialogComponent', type: NewFolderDialogComponent },
  { name: 'OrderWorkflowDialogComponent', type: OrderWorkflowDialogComponent },
  { name: 'OrganizationDetailsComponent', type: OrganizationDetailsComponent },
  { name: 'OrganizationLocationDialogComponent', type: OrganizationLocationDialogComponent },
  { name: 'OrganizationsComponent', type: OrganizationsComponent },
  { name: 'PagedTableFooterComponent', type: PagedTableFooterComponent },
  { name: 'PhoneFieldComponent', type: PhoneFieldComponent },
  { name: 'PopupEditorComponent', type: PopupEditorComponent },
  { name: 'PopupHeaderComponent', type: PopupHeaderComponent },
  { name: 'ProductCategoriesComponent', type: ProductCategoriesComponent },
  { name: 'ProductsComponent', type: ProductsComponent },
  { name: 'ProductSeriesComponent', type: ProductSeriesComponent },
  { name: 'PurchasesComponent', type: PurchasesComponent },
  { name: 'RefundDialogComponent', type: RefundDialogComponent },
  { name: 'RenameDialogComponent', type: RenameDialogComponent },
  { name: 'ReportsManagerComponent', type: ReportsManagerComponent },
  { name: 'ResetPasswordComponent', type: ResetPasswordComponent },
  { name: 'RoomComponent', type: RoomComponent },
  { name: 'RoomDialogComponent', type: RoomDialogComponent },
  { name: 'RouteRequestDialogComponent', type: RouteRequestDialogComponent },
  { name: 'SaveAsTemplateDialogComponent', type: SaveAsTemplateDialogComponent },
  { name: 'ScreenPermissionsDialogComponent', type: ScreenPermissionsDialogComponent },
  { name: 'SendSubscriptionDialogComponent', type: SendSubscriptionDialogComponent },
  { name: 'SendTestDialogComponent', type: SendTestDialogComponent },
  { name: 'SentEmailPreviewDialogComponent', type: SentEmailPreviewDialogComponent },
  { name: 'SentEmailsComponent', type: SentEmailsComponent },
  { name: 'SeriesModalComponent', type: SeriesModalComponent },
  { name: 'ShippingLabelDialogComponent', type: ShippingLabelDialogComponent },
  { name: 'ShippingLabelsComponent', type: ShippingLabelsComponent },
  { name: 'SocialComposerComponent', type: SocialComposerComponent },
  { name: 'StatusBoardComponent', type: StatusBoardComponent },
  { name: 'StoreManagerComponent', type: StoreManagerComponent },
  { name: 'SubscriberReportComponent', type: SubscriberReportComponent },
  { name: 'SubtemplateCreateDialogComponent', type: SubtemplateCreateDialogComponent },
  { name: 'SubtemplateEditorComponent', type: SubtemplateEditorComponent },
  { name: 'SummitPreviewComponent', type: SummitPreviewComponent },
  { name: 'SummitPreviewRailComponent', type: SummitPreviewRailComponent },
  { name: 'SummitSetupWizardComponent', type: SummitSetupWizardComponent },
  { name: 'TableLoadingOverlayComponent', type: TableLoadingOverlayComponent },
  { name: 'TagChipsComponent', type: TagChipsComponent },
  { name: 'TagRulesComponent', type: TagRulesComponent },
  { name: 'TeamPageComponent', type: TeamPageComponent },
  { name: 'TestimonialDialogComponent', type: TestimonialDialogComponent },
  { name: 'TestimonialsComponent', type: TestimonialsComponent },
  { name: 'ThemesComponent', type: ThemesComponent },
  { name: 'ToolsManagerComponent', type: ToolsManagerComponent },
  { name: 'VariableInserterComponent', type: VariableInserterComponent },
  { name: 'VenueRoomsDialogComponent', type: VenueRoomsDialogComponent },
  { name: 'WebConfigComponent', type: WebConfigComponent },
  { name: 'WebNewslettersComponent', type: WebNewslettersComponent },
];

// Components that need more scaffolding than this shared pool provides.
// Asserted as loadable so a broken import or circular dependency still
// fails here, but NOT constructed - and this file does not pretend
// otherwise.
const IMPORT_ONLY: ComponentRow[] = [
  { name: 'AppComponent', type: AppComponent },
  { name: 'BlockHostComponent', type: BlockHostComponent },
  { name: 'BlockStyleEditorComponent', type: BlockStyleEditorComponent },
  { name: 'BreakoutBlockDialogComponent', type: BreakoutBlockDialogComponent },
  { name: 'CoachDialogComponent', type: CoachDialogComponent },
  { name: 'CreateOrgContactDialogComponent', type: CreateOrgContactDialogComponent },
  { name: 'CustomFormSubmissionDetailDialogComponent', type: CustomFormSubmissionDetailDialogComponent },
  { name: 'DailyReadingDialogComponent', type: DailyReadingDialogComponent },
  { name: 'DesignCanvasComponent', type: DesignCanvasComponent },
  { name: 'EmailDesignerComponent', type: EmailDesignerComponent },
  { name: 'FileTreeNodeComponent', type: FileTreeNodeComponent },
  { name: 'FolderPickerDialogComponent', type: FolderPickerDialogComponent },
  { name: 'GlobalStylesPanelComponent', type: GlobalStylesPanelComponent },
  { name: 'InlineTextEditorComponent', type: InlineTextEditorComponent },
  { name: 'LibraryGrantLicensesDialogComponent', type: LibraryGrantLicensesDialogComponent },
  { name: 'LibraryPermissionDialogComponent', type: LibraryPermissionDialogComponent },
  { name: 'LibrarySendMessageDialogComponent', type: LibrarySendMessageDialogComponent },
  { name: 'NewRecordAlertsComponent', type: NewRecordAlertsComponent },
  { name: 'PreviewDialogComponent', type: PreviewDialogComponent },
  { name: 'PublishWebDialogComponent', type: PublishWebDialogComponent },
  { name: 'SubscriberDialogComponent', type: SubscriberDialogComponent },
  { name: 'TeamPageDialogComponent', type: TeamPageDialogComponent },
  { name: 'TemplatePickerDialogComponent', type: TemplatePickerDialogComponent },
  { name: 'WorldMapComponent', type: WorldMapComponent },
];

// NOT DONE, deliberately: an ngOnInit tier.
//
// Calling ngOnInit on each of these was tried (2026-08-22) and backed out.
// With a realistic DAO stub only 5 of 119 threw synchronously - but several
// set up combineLatest pipelines that fail LATER, asynchronously, where a
// synchronous expect(...).not.toThrow() cannot see them. Those land in
// afterAll and turn the whole run red without naming a culprit.
//
// Making that tier honest needs per-component stubs, which is what a real
// spec for each component is. Better to write those than to bolt an
// unreliable tier onto this one.

describe('components - construction smoke', () => {
  afterEach(() => TestBed.resetTestingModule());

  for (const { name, type } of CONSTRUCTIBLE) {
    it(`${name} constructs`, () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [type, ...PROVIDERS] });
      expect(TestBed.inject(type)).toBeTruthy();
    });
  }

  for (const { name, type } of IMPORT_ONLY) {
    it(`${name} loads`, () => {
      expect(type).toBeDefined();
    });
  }

  it('names every component exactly once', () => {
    const names = [...CONSTRUCTIBLE, ...IMPORT_ONLY].map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
