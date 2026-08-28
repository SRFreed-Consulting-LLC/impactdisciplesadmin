import { FIREBASE_PROJECTS, functionUrl } from '@impact-common/shared/config/firebase-projects';

export const environment = {
  production: false,
  useEmulators: false,
  firebaseConfig: FIREBASE_PROJECTS.dev,
  shippingUrl: functionUrl('dev', 'get_shipping_rates'),
  shippingLabelUrl: functionUrl('dev', 'get_shipping_label'),
  unsubscribeUrl: functionUrl('dev', 'unsubscribe_from_email_list'),
  publicSiteUrl: "https://impactdisciplesdev-public.web.app",
  application: "admin",
  shippingCarriers: ["se-1047082"],
};


