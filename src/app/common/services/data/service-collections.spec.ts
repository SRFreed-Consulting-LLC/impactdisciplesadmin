import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { LibraryActivityLogService } from 'src/app/common/services/data/library/library-activity-log.service';
import { LoggerService } from 'src/app/common/services/data/logger.service';
import { AdminUserService } from 'src/app/common/services/data/admin-user.service';
import { AffilliateSalesService } from 'src/app/common/services/data/affiliate-sales.service';
import { CampaignEmailService } from 'src/app/common/services/data/campaign-email.service';
import { CampaignPopupService } from 'src/app/common/services/data/campaign-popup.service';
import { CampaignService } from 'src/app/common/services/data/campaign.service';
import { CoachService } from 'src/app/common/services/data/coach.service';
import { ContactService } from 'src/app/common/services/data/contact.service';
import { CouponService } from 'src/app/common/services/data/coupon.service';
import { DMMService } from 'src/app/common/services/data/dmm.service';
import { EMailService } from 'src/app/common/services/data/email.service';
import { EventRegistrationService } from 'src/app/common/services/data/event-registration.service';
import { EventService } from 'src/app/common/services/data/event.service';
import { FAQService } from 'src/app/common/services/data/faq.service';
import { FormDefinitionService } from 'src/app/common/services/data/form-definition.service';
import { FormSubmissionService } from 'src/app/common/services/data/form-submission.service';
import { ImpactTeamService } from 'src/app/common/services/data/impact-team.service';
import { LibraryLessonTemplateService } from 'src/app/common/services/data/library/library-lesson-template.service';
import { LibrarySubtemplateService } from 'src/app/common/services/data/library/library-subtemplate.service';
import { LocationService } from 'src/app/common/services/data/location.service';
import { OrganizationService } from 'src/app/common/services/data/organization.service';
import { ProductCategoriesService } from 'src/app/common/services/data/product-categories.service';
import { ProductService } from 'src/app/common/services/data/product.service';
import { ProductTagsService } from 'src/app/common/services/data/product-tags.service';
import { SeriesService } from 'src/app/common/services/data/series.service';
import { ShippingLabelBatchService } from 'src/app/common/services/data/shipping-label-batch.service';
import { ShippingLabelService } from 'src/app/common/services/data/shipping-label.service';
import { TagApplicationService } from 'src/app/common/services/data/tag-application.service';
import { TagRuleService } from 'src/app/common/services/data/tag-rule.service';
import { TestimonialService } from 'src/app/common/services/data/testimonial.service';
import { WebConfigService } from 'src/app/common/services/data/web-config.service';

// Every BaseService subclass in the app, checked for the one thing that
// makes each different from its siblings: WHICH Firestore collection it
// reads and writes.
//
// Worth asserting because a wrong table name fails SILENTLY. The service
// still constructs, every method still resolves, and reads just return
// nothing from a collection that does not exist - or, worse, rows from the
// wrong one. Nothing else in the suite would notice. The web app's
// shipping.service.ts sat pointed at a `shipments` collection that had been
// deleted, and only a hand audit ever found it.
//
// TestBed as an INJECTOR only - nothing renders - so this resolves
// constructor parameters and `inject()` field initializers alike, and keeps
// working unchanged as these services move to `inject()`.

/** Structural: every one of these exposes a table name and a DAO. */
interface CollectionService { table: string; dao: unknown; }
type ServiceCtor = Type<CollectionService>;

// `name` is carried as a literal rather than read off the class at
// runtime: the bundler mangles class names once everything is compiled
// into one test bundle (35 classes collapsed to 19 distinct `.name`
// values), which made both the spec titles and any uniqueness check
// meaningless.
interface ServiceRow { service: ServiceCtor; table: string; name: string; }

const SERVICE_TABLES: ServiceRow[] = [
  { service: AdminUserService, table: 'admin_users', name: 'AdminUserService' },
  { service: AffilliateSalesService, table: 'affilliate_sales', name: 'AffilliateSalesService' },
  { service: CampaignEmailService, table: 'campaign_emails', name: 'CampaignEmailService' },
  { service: CampaignPopupService, table: 'campaign_popups', name: 'CampaignPopupService' },
  { service: CampaignService, table: 'campaigns', name: 'CampaignService' },
  { service: CoachService, table: 'coaches', name: 'CoachService' },
  { service: ContactService, table: 'customers', name: 'ContactService' },
  { service: CouponService, table: 'coupons', name: 'CouponService' },
  { service: DMMService, table: 'dmms', name: 'DMMService' },
  { service: EMailService, table: 'mail', name: 'EMailService' },
  { service: EventRegistrationService, table: 'event-registrations', name: 'EventRegistrationService' },
  { service: EventService, table: 'events', name: 'EventService' },
  { service: FAQService, table: 'faq', name: 'FAQService' },
  { service: FormDefinitionService, table: 'forms', name: 'FormDefinitionService' },
  { service: FormSubmissionService, table: 'form_submissions', name: 'FormSubmissionService' },
  { service: ImpactTeamService, table: 'impact_team', name: 'ImpactTeamService' },
  { service: LibraryLessonTemplateService, table: 'lessonTemplates', name: 'LibraryLessonTemplateService' },
  { service: LibrarySubtemplateService, table: 'subtemplates', name: 'LibrarySubtemplateService' },
  { service: LocationService, table: 'locations', name: 'LocationService' },
  { service: LoggerService, table: 'log-messages', name: 'LoggerService' },
  { service: OrganizationService, table: 'organizations', name: 'OrganizationService' },
  { service: ProductCategoriesService, table: 'product_categories', name: 'ProductCategoriesService' },
  { service: ProductService, table: 'products', name: 'ProductService' },
  { service: ProductTagsService, table: 'product_tags', name: 'ProductTagsService' },
  { service: SeriesService, table: 'series', name: 'SeriesService' },
  { service: ShippingLabelBatchService, table: 'shipping-label-batches', name: 'ShippingLabelBatchService' },
  { service: ShippingLabelService, table: 'shipping-labels', name: 'ShippingLabelService' },
  { service: TagApplicationService, table: 'tag_applications', name: 'TagApplicationService' },
  { service: TagRuleService, table: 'tag_rules', name: 'TagRuleService' },
  { service: TestimonialService, table: 'testimonials', name: 'TestimonialService' },
  { service: WebConfigService, table: 'config', name: 'WebConfigService' },
];

describe('data services - collection mapping', () => {
  afterEach(() => TestBed.resetTestingModule());

  function make(ServiceClass: ServiceCtor): CollectionService {
    // Collaborators a handful of these take beyond the DAO. Harmless for
    // the rest - an unused provider costs nothing. Any stub for the class
    // currently UNDER TEST is dropped, or it would shadow the real thing
    // and the assertions would read the stub (LoggerService is both a
    // collaborator here and a service in its own right).
    const collaborators = [
      { provide: LoggerService, useValue: { logMessage: () => undefined } },
      { provide: AdminAuthService, useValue: { dao: { loggedInUser$: { subscribe: () => undefined } } } },
      { provide: LibraryActivityLogService, useValue: { log: () => undefined } },
    ].filter((p) => p.provide !== (ServiceClass as unknown));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ServiceClass,
        { provide: FirebaseDAO, useValue: {} },
        { provide: Auth, useValue: {} },
        { provide: Functions, useValue: {} },
        { provide: Firestore, useValue: {} },
        ...collaborators,
      ],
    });
    return TestBed.inject(ServiceClass);
  }

  for (const { service, table: expectedTable, name } of SERVICE_TABLES) {
    describe(name, () => {
      it('constructs', () => {
        expect(make(service)).toBeTruthy();
      });

      it(`reads and writes the ${expectedTable} collection`, () => {
        expect(make(service).table).toBe(expectedTable);
      });

      it('is wired to a DAO', () => {
        expect(make(service).dao).toBeDefined();
      });
    });
  }

  it('lists every service exactly once', () => {
    const names = SERVICE_TABLES.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('maps no two services to the same collection', () => {
    // Two services on one collection is legal but almost always a
    // copy-paste slip - surface it rather than let it pass unnoticed.
    const tables = SERVICE_TABLES.map((r) => r.table);
    const dupes = tables.filter((t, i) => tables.indexOf(t) !== i);
    expect(dupes).withContext(`collections claimed twice: ${dupes}`).toEqual([]);
  });
});
