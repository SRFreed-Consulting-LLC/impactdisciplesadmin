import { APP_URLS, FIREBASE_PROJECTS, functionUrl } from '@impact-common/shared/config/firebase-projects';

export const environment = {
  production: true,
  useEmulators: false,
  firebaseConfig: FIREBASE_PROJECTS.prod,
  shippingUrl: functionUrl('prod', 'get_shipping_rates'),
  shippingLabelUrl: functionUrl('prod', 'get_shipping_label'),
  unsubscribeUrl: functionUrl('prod', 'unsubscribe_from_email_list'),
  publicSiteUrl: "https://impactdisciples.com",
  // WHICH web app Page Manager's previewer frames - see
  // environment-local.ts, and page-live-preview.component.ts for the
  // staleness caveat that comes with framing a DEPLOYED site.
  previewSiteUrl: APP_URLS.web.prod,
  shippingCarriers: ["se-1047625"],
};


