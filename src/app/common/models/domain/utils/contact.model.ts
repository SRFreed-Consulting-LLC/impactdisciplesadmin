// THE `customers` document type lives in the shared submodule since
// 2026-09-05 (@impact-common/shared/models/domain/contact.model) - the web
// site reads the same document and used to carry its own four-field
// CustomerModel. This file re-exports it so the fifteen importers here keep
// their path; the document's own story is in the shared file's header.
export {
  ContactModel,
  subscriptionFieldsForType,
} from '@impact-common/shared/models/domain/contact.model';
export type {
  PendingContactChange,
  SubscriptionType,
} from '@impact-common/shared/models/domain/contact.model';
