import { APP_URLS, FIREBASE_PROJECTS, functionUrl } from '@impact-common/shared/config/firebase-projects';

export const environment = {
  production: false,
  useEmulators: false,
  firebaseConfig: FIREBASE_PROJECTS.dev,
  shippingUrl: functionUrl('dev', 'get_shipping_rates'),
  shippingLabelUrl: functionUrl('dev', 'get_shipping_label'),
  unsubscribeUrl: functionUrl('dev', 'unsubscribe_from_email_list'),
  publicSiteUrl: "https://impactdisciplesdev-public.web.app",
  // WHICH web app Page Manager's previewer frames - see
  // environment-local.ts, and page-live-preview.component.ts for the
  // staleness caveat that comes with framing a DEPLOYED site.
  previewSiteUrl: APP_URLS.web.dev,
  shippingCarriers: ["se-1047082"],
};


