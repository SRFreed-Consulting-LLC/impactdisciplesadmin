// The deterministic fixture world every emulator-backed test layer runs
// against (seeded by scripts/seed-emulator.js, consumed by integration/ and
// e2e-cross/). Plain JS objects, fixed doc ids, no Date.now() - the same
// seed always produces the same world. Dates are ISO strings here; the seed
// script converts the *Date fields to real Timestamps so range
// queries/sorts behave like production data (see MIGRATION.md on why
// date-shape consistency matters).
//
// Auth accounts live in AUTH_USERS; everything else is keyed by collection
// name exactly as the app services spell them (see the `table=` assignments
// under src/app/common/services/data/).

// Fixed "now" for the fixture world: events/campaigns are positioned
// relative to this so the seed is stable no matter when it runs. Tests that
// need "upcoming" semantics get them because the summit sits a year out.
const T0 = "2026-08-01T12:00:00.000Z";

const AUTH_USERS = [
  {uid: "admin-uid-0001", email: "admin@test.local", password: "test-password-1"},
  {uid: "employee-uid-0001", email: "employee@test.local", password: "test-password-1"},
  {uid: "patron-uid-0001", email: "patron@test.local", password: "test-password-1"},
];

// ---- staff --------------------------------------------------------------

const admin_users = {
  "admin-user-0001": {
    email: "admin@test.local",
    firebaseUID: "admin-uid-0001",
    firstName: "Ada",
    lastName: "Admin",
    role: "Admin",
  },
  "admin-user-0002": {
    email: "employee@test.local",
    firebaseUID: "employee-uid-0001",
    firstName: "Emmett",
    lastName: "Employee",
    role: "Employee",
    // Narrow on purpose: store only - permission tests assert the fences.
    permissions: [
      {screenKey: "store-manager", canView: true},
      {screenKey: "store-manager.products", canView: true},
    ],
  },
};

// ---- store --------------------------------------------------------------

const product_categories = {
  "cat-books": {category: "Books", name: "Books", categoryOrder: 1},
  "cat-merch": {category: "Merchandise", name: "Merchandise", categoryOrder: 2},
};

const series = {
  // Shape per SeriesModel (name/order/imageUrl/showInStore). Products link
  // by NAME (ProductModel.series is the display string, not a doc id).
  "series-m7": {
    name: "M-7 Series", order: 1, showInStore: true,
    imageUrl: {url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", name: "m7-series.png"},
  },
};

const products = {
  "prod-book-physical": {
    isActive: true, showInStore: true, title: "Disciple-Making Field Guide",
    cost: 20, salePrice: 0, category: "Books", series: "M-7 Series",
    description: "A physical paperback.", weight: 1, uom: "POUNDS",
    seriesOrder: 1, categoryOrder: 1,
    isEBook: false, isDigitalBook: false,
    imageUrl: {url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", name: "field-guide.png"},
    sendFollowUpEmail: false,
  },
  "prod-book-digital": {
    isActive: true, showInStore: true, title: "Field Guide (Library Edition)",
    cost: 10, salePrice: 0, category: "Books",
    description: "Digital book unlocked in the reader app.",
    seriesOrder: 2, categoryOrder: 2,
    isEBook: false, isDigitalBook: true, digitalBookId: "lib-book-0001",
    imageUrl: {url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", name: "fg-digital.png"},
    sendFollowUpEmail: false,
  },
  "prod-ebook": {
    isActive: true, showInStore: true, title: "Multiplication Primer (eBook)",
    cost: 5, salePrice: 0, category: "Books",
    description: "A PDF eBook delivered by link.",
    seriesOrder: 3, categoryOrder: 3,
    isEBook: true, isDigitalBook: false,
    eBookUrl: {url: "https://example.test/primer.pdf", name: "primer.pdf"},
    imageUrl: {url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", name: "primer.png"},
    sendFollowUpEmail: false,
  },
  "prod-shirt": {
    isActive: true, showInStore: true, title: "Impact Tee",
    cost: 18, salePrice: 0, category: "Merchandise",
    description: "A t-shirt.", weight: 0.5, uom: "POUNDS",
    seriesOrder: 1, categoryOrder: 1,
    isEBook: false, isDigitalBook: false,
    sizes: ["S", "M", "L", "XL"], colors: ["Navy", "White"],
    imageUrl: {url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", name: "tee.png"},
    sendFollowUpEmail: false,
  },
  "prod-followup": {
    isActive: true, showInStore: true, title: "Coaching Workbook",
    cost: 25, salePrice: 0, category: "Books",
    description: "Physical book with a follow-up email.", weight: 1.2, uom: "POUNDS",
    seriesOrder: 4, categoryOrder: 4,
    isEBook: false, isDigitalBook: false,
    imageUrl: {url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", name: "workbook.png"},
    sendFollowUpEmail: true, followUpEmailId: "tmpl-followup",
  },
  "prod-inactive": {
    isActive: false, showInStore: false, title: "Retired Product",
    cost: 99, salePrice: 0, category: "Books",
    description: "Must never appear on the public store.",
    seriesOrder: 9, categoryOrder: 9,
    isEBook: false, isDigitalBook: false,
    sendFollowUpEmail: false,
  },
};

const coupons = {
  "coupon-free": {isActive: true, code: "FREE100", percentOff: 100, isAffilliate: false},
  "coupon-save10": {isActive: true, code: "SAVE10", percentOff: 10, isAffilliate: false},
  "coupon-expired": {isActive: false, code: "OLDCODE", percentOff: 50, isAffilliate: false},
};

// ---- contacts world -----------------------------------------------------

const organizations = {
  "org-crossroads": {
    name: "Crossroads Church",
    address: {address1: "100 Main St", city: "Sharpsburg", state: "GA", zip: "30277", country: "US"},
    phone: {countryCode: "1", area: "770", prefix: "555", line: "0100"},
    email: "office@crossroads.test",
    pointOfContact: {firstName: "Cora", lastName: "Ross", email: "cora@crossroads.test"},
  },
  "org-single-site": {
    name: "Hope Fellowship",
    address: {address1: "9 Chapel Rd", city: "Newnan", state: "GA", zip: "30263", country: "US"},
    phone: {countryCode: "1", area: "770", prefix: "555", line: "0200"},
    pointOfContact: {firstName: "Hank", lastName: "Hope", email: "hank@hope.test"},
  },
  "org-partner": {
    name: "Kingdom Partners Intl",
    address: {address1: "42 Global Way", city: "Atlanta", state: "GA", zip: "30303", country: "US"},
    phone: {countryCode: "1", area: "404", prefix: "555", line: "0300"},
  },
};

const locations = {
  // THE summit venue - the one isSummitVenue doc the Summit screens pin to.
  "loc-hwy16": {
    name: "Crossroads Church, HWY 16 Campus",
    organization: "org-crossroads",
    isSummitVenue: true,
    address: {address1: "2564 Highway 16", city: "Sharpsburg", state: "GA", zip: "30277", country: "US"},
    trainingrooms: [
      {name: "Worship Center", capacity: 400},
      {name: "Room 101", capacity: 30},
      {name: "Room 102", capacity: 30},
      {name: "Chapel", capacity: 60},
    ],
  },
  "loc-crossroads-downtown": {
    name: "Crossroads Downtown Campus",
    organization: "org-crossroads",
    address: {address1: "12 Court Sq", city: "Newnan", state: "GA", zip: "30263", country: "US"},
    trainingrooms: [],
  },
};

// 12 customers: a mix of newsletter/prayer subscription states so the
// Subscriber Report criteria and blast audience counts have real data.
// c-01..c-06 newsletter, c-04..c-08 prayer (overlap on 04-06), c-09..c-12
// unsubscribed entirely.
const customers = {};
for (let i = 1; i <= 12; i++) {
  const n = String(i).padStart(2, "0");
  customers[`cust-00${n}`] = {
    firstName: `Casey${n}`,
    lastName: `Contact${n}`,
    email: `casey${n}@contacts.test`,
    role: "Customer",
    subscribedToNewsletter: i <= 6,
    ...(i <= 6 ? {newsletterSubscribedDate: T0} : {}),
    subscribedToPrayerTeam: i >= 4 && i <= 8,
    ...(i >= 4 && i <= 8 ? {prayerTeamSubscribedDate: T0} : {}),
    ...(i === 1 ? {organizationId: "org-crossroads"} : {}),
  };
}

// ---- events -------------------------------------------------------------

// Breakout block: 3 options sharing one identical time pair (that's what
// makes them a block - see session-block.util.ts). breakout-c is small
// (max 2) so capacity/queue tests can fill it fast.
const SUMMIT_AGENDA = [
  {id: "agenda-plenary-1", text: "Opening Session", name: "Opening Session",
    startDate: "2027-01-29T14:00:00.000Z", endDate: "2027-01-29T15:00:00.000Z"},
  {id: "agenda-breakout-a", text: "Making Disciples at Work", isCourse: true,
    description: "Workplace disciple-making.", room: "Room 101", maxParticipants: 30,
    startDate: "2027-01-29T15:15:00.000Z", endDate: "2027-01-29T16:15:00.000Z"},
  {id: "agenda-breakout-b", text: "Family Discipleship", isCourse: true,
    description: "Discipleship at home.", room: "Room 102", maxParticipants: 30,
    startDate: "2027-01-29T15:15:00.000Z", endDate: "2027-01-29T16:15:00.000Z"},
  {id: "agenda-breakout-c", text: "Church Planting Panel", isCourse: true,
    description: "Q&A with planters.", room: "Chapel", maxParticipants: 2,
    startDate: "2027-01-29T15:15:00.000Z", endDate: "2027-01-29T16:15:00.000Z"},
  {id: "agenda-plenary-2", text: "Closing Commission", name: "Closing Commission",
    startDate: "2027-01-29T16:30:00.000Z", endDate: "2027-01-29T17:30:00.000Z"},
];

const events = {
  "event-summit-2027": {
    isActive: true, isSummit: true, isOnline: false, isKajabiCourse: false,
    eventName: "Disciple-Making Summit 2027",
    description: "Two days of practical disciple-making training.",
    videoId: "MUPDplOSOR4",
    emailTemplate: "Event Registration Confirmation",
    organization: "org-crossroads",
    location: "loc-hwy16",
    venue: {
      name: "Crossroads Church, HWY 16 Campus",
      address: {address1: "2564 Highway 16", city: "Sharpsburg", state: "GA", zip: "30277", country: "US"},
    },
    startDate: "2027-01-29T14:00:00.000Z",
    endDate: "2027-01-30T21:00:00.000Z",
    checkIn: "2027-01-29T13:30:00.000Z",
    costInDollars: 0,
    agendaItems: SUMMIT_AGENDA,
    faqList: [{question: "What should I bring?", answer: "A Bible and a notebook."}],
    imageUrl: {url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", name: "summit-2027.png"},
    diningOptions: "Lunch provided both days.",
    checkinInstructions: "Check in at the Worship Center lobby.",
  },
  "event-workshop": {
    isActive: true, isSummit: false, isOnline: false, isKajabiCourse: false,
    eventName: "Fall Multiplication Workshop",
    description: "A one-day workshop.",
    organization: "org-single-site",
    // Single-site org: no location child - venue snapshots the org address.
    venue: {
      name: "Hope Fellowship",
      address: {address1: "9 Chapel Rd", city: "Newnan", state: "GA", zip: "30263", country: "US"},
    },
    startDate: "2026-10-10T13:00:00.000Z",
    endDate: "2026-10-10T20:00:00.000Z",
    costInDollars: 10,
    agendaItems: [],
    faqList: [],
  },
};

// 30 summit registrations: r01-r10 in breakout A, r11-r18 in breakout B,
// r19-r20 fill tiny breakout C (max 2), r21-r30 picked nothing (the
// no-breakout reminder audience). Registered order = index order.
const eventRegistrations = {};
for (let i = 1; i <= 30; i++) {
  const n = String(i).padStart(2, "0");
  const sessions =
    i <= 10 ? ["agenda-breakout-a"] :
    i <= 18 ? ["agenda-breakout-b"] :
    i <= 20 ? ["agenda-breakout-c"] : [];
  eventRegistrations[`reg-00${n}`] = {
    firstName: `Attendee${n}`,
    lastName: `Zulu${n}`,
    lastNameLower: `zulu${n}`,
    email: `attendee${n}@summit.test`,
    eventId: "event-summit-2027",
    registrationDate: T0,
    trainingSessions: sessions,
    receipt: `receipt-${n}`,
    receiptEmailStatus: "sent",
    receiptEmailDate: T0,
  };
}

// ---- forms --------------------------------------------------------------

const forms = {
  "form-contact-us": {
    title: "Contact Us",
    isActive: true,
    fields: [
      {key: "firstName", label: "First Name", type: "text", required: true},
      {key: "lastName", label: "Last Name", type: "text", required: true},
      {key: "email", label: "Email", type: "email", required: true},
      {key: "message", label: "Message", type: "textarea", required: true},
    ],
  },
  "form-seminar": {
    title: "Seminar Request",
    isActive: true,
    fields: [
      {key: "churchName", label: "Church / Organization", type: "text", required: true},
      {key: "coordinatorName", label: "Coordinator Name", type: "text", required: true},
      {key: "email", label: "Email", type: "email", required: true},
      {key: "city", label: "City", type: "text", required: false},
      {key: "state", label: "State", type: "text", required: false},
    ],
  },
};

const form_submissions = {
  "sub-contact-1": {
    formId: "form-contact-us", formTitle: "Contact Us",
    submittedAt: T0, newRecordStatus: "new",
    data: {firstName: "Frank", lastName: "Farmer", email: "frank@farm.test", message: "Tell me more."},
  },
  "sub-seminar-1": {
    formId: "form-seminar", formTitle: "Seminar Request",
    submittedAt: T0, newRecordStatus: "new",
    data: {churchName: "Riverbend Chapel", coordinatorName: "Rita Bend",
      email: "rita@riverbend.test", city: "Macon", state: "GA"},
  },
};

// ---- email / campaigns --------------------------------------------------

const mail_templates = {
  // Looked up BY NAME by the sales-receipt path - the literal name matters.
  "tmpl-sales-receipt": {
    name: "Sales Receipt",
    subject: "Your Impact Disciples receipt",
    html: "<p>Thanks {{Customer Name}}! Order total: {{Order Total}}.</p>{{Order Details}}",
  },
  "tmpl-amazon-confirm": {
    name: "Amazon Shipping Confirmation",
    subject: "Your order is on the way",
    html: "<p>{{Customer Name}}, your order shipped via Amazon.</p>",
  },
  "tmpl-followup": {
    name: "Workbook Follow-Up",
    subject: "Getting the most from your workbook",
    html: "<p>Hi {{Customer Name}} - tips inside.</p>",
  },
  // Referenced by the summit fixture's emailTemplate (by NAME) - the
  // register_for_event flow renders + queues this as the confirmation.
  "tmpl-event-confirmation": {
    name: "Event Registration Confirmation",
    subject: "You are registered, {{Recipient First Name}}!",
    html: "<p>See you at {{Event Name}}, {{Recipient First Name}}.</p>" +
      "<p><a href=\"{{Breakout Link}}\">Pick your breakout sessions</a></p>",
  },
  "tmpl-newsletter": {
    name: "Monthly Newsletter Shell",
    subject: "Impact Disciples Newsletter",
    html: "<p>Hello *|FNAME|*!</p><p><a href=\"https://impactdisciples.com/blog\">Read the blog</a></p><p><a href=\"*|UNSUB|*\">Unsubscribe</a></p>",
  },
};

const campaigns = {
  "camp-live": {
    name: "Fall Workbook Push",
    goal: "product", productId: "prod-followup",
    channels: ["email"],
    status: "live",
    startDate: "2026-07-15T00:00:00.000Z", endDate: "2026-12-31T00:00:00.000Z",
    // The shape resolveAudience actually accepts (campaign-send.functions.ts):
    // flags mode + customer boolean field names.
    audience: {mode: "flags", flags: ["subscribedToNewsletter"]},
    stats: {sent: 0, delivered: 0, opens: 0, uniqueOpens: 0, clicks: 0,
      uniqueClicks: 0, purchases: 0, revenue: 0, registrations: 0,
      subscribes: 0, webShown: 0, webClicks: 0},
    couponId: "coupon-save10",
  },
  "camp-past": {
    name: "Spring Newsletter",
    goal: "other", otherKind: "newsletter",
    channels: ["email"],
    status: "done",
    startDate: "2026-03-01T00:00:00.000Z", endDate: "2026-04-01T00:00:00.000Z",
    audience: {mode: "flags", flags: ["subscribedToNewsletter"]},
    stats: {sent: 6, delivered: 6, opens: 4, uniqueOpens: 3, clicks: 2,
      uniqueClicks: 2, purchases: 0, revenue: 0, registrations: 0,
      subscribes: 0, webShown: 0, webClicks: 0},
  },
};

const campaign_emails = {
  "cemail-past-1": {
    campaignId: "camp-past",
    label: "March issue",
    subject: "Spring update from Impact Disciples",
    html: "<p>Hello *|FNAME|*!</p>",
    sentAt: "2026-03-05T15:00:00.000Z",
    stats: {sent: 6, delivered: 6, opens: 4, uniqueOpens: 3, clicks: 2, uniqueClicks: 2},
    sendConfig: {mode: "now"},
  },
};

// ---- library (admin <-> reader seam) ------------------------------------

// NOTE on `order` (additive enrichment for the reader-app cross flows): the
// reader's queries sort series/books/units/lessons by an `order` field
// (library-queries.ts / LibraryService.getSeriesList), and Firestore's
// orderBy() silently EXCLUDES docs missing the field - without `order`, the
// seeded units/lessons never render in the reader at all. `sortOrder` is
// kept untouched for whatever seeded it first.
const librarySeriesTree = {
  "lib-series-0001": {
    doc: {title: "Foundations Series", sortOrder: 1, order: 1},
    books: {
      "lib-book-0001": {
        doc: {title: "Foundations of Disciple-Making", sortOrder: 1, order: 1,
          description: "The digital book the store's prod-book-digital unlocks."},
        units: {
          "lib-unit-0001": {
            doc: {title: "Unit 1: First Steps", sortOrder: 1, order: 1},
            lessons: {
              "lib-lesson-0001": {
                doc: {title: "Lesson 1: Why Multiply", sortOrder: 1, order: 1},
              },
            },
          },
        },
      },
      "lib-book-0002": {
        doc: {title: "Advanced Multiplication", sortOrder: 2, order: 2,
          description: "A second book nobody is licensed for by default."},
        // A unit+lesson so a license grant is provable in the reader UI: the
        // book-detail unit/lesson list is the rules-gated read (canReadBook),
        // so it rendering IS the proof of content access.
        units: {
          "lib-unit-0002": {
            doc: {title: "Unit 1: Multiplying Movements", sortOrder: 1, order: 1},
            lessons: {
              "lib-lesson-0002": {
                doc: {title: "Lesson 1: Beyond Addition", sortOrder: 1, order: 1},
              },
            },
          },
        },
      },
    },
  },
};

// Doc id = lowercased email (the reader app's convention).
const libraryUsers = {
  "patron@test.local": {
    email: "patron@test.local",
    firstName: "Pat", lastName: "Patron",
    userId: "patron-uid-0001",
    licensedBookIds: ["lib-book-0001"],
    bookLicenses: [{bookId: "lib-book-0001", purchaseDate: T0, source: "admin-grant", grantedBy: "seed"}],
  },
  "casey01@contacts.test": {
    email: "casey01@contacts.test",
    firstName: "Casey01", lastName: "Contact01",
    licensedBookIds: [],
    bookLicenses: [],
  },
};

const bulkDiscountTiers = {
  "5": {numberOfBooks: 5, percentOff: 10},
  "10": {numberOfBooks: 10, percentOff: 20},
};

module.exports = {
  T0,
  AUTH_USERS,
  // Flat top-level collections, keyed by collection name -> {docId: data}.
  collections: {
    admin_users,
    product_categories,
    series,
    products,
    coupons,
    organizations,
    locations,
    customers,
    events,
    "event-registrations": eventRegistrations,
    forms,
    form_submissions,
    mail_templates,
    campaigns,
    campaign_emails,
    libraryUsers,
    bulkDiscountTiers,
  },
  librarySeriesTree,
};
