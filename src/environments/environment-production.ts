import { FIREBASE_PROJECTS, functionUrl } from '@impact-common/shared/config/firebase-projects';

export const environment = {
  production: true,
  useEmulators: false,
  firebaseConfig: FIREBASE_PROJECTS.prod,
  shippingUrl: functionUrl('prod', 'get_shipping_rates'),
  shippingLabelUrl: functionUrl('prod', 'get_shipping_label'),
  unsubscribeUrl: functionUrl('prod', 'unsubscribe_from_email_list'),
  publicSiteUrl: "https://impactdisciples.com",
  shippingCarriers: ["se-1047625"],
};


