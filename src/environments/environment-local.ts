import { FIREBASE_PROJECTS, LOCAL_APP_URLS, functionUrl } from '@impact-common/shared/config/firebase-projects';

export const environment = {
  production: false,
  useEmulators: false,
  firebaseConfig: FIREBASE_PROJECTS.dev,
  shippingUrl: functionUrl('dev', 'get_shipping_rates'),
  shippingLabelUrl: functionUrl('dev', 'get_shipping_label'),
  unsubscribeUrl: functionUrl('dev', 'unsubscribe_from_email_list'),
  publicSiteUrl: "https://impactdisciplesdev-public.web.app",
  // WHICH web app Page Manager's previewer frames. Locally that is YOUR web
  // server on 4200 - the x200 half of the port rule - so the preview shows
  // the build you are working on rather than whatever was last deployed.
  // Never a literal: LOCAL_APP_URLS is where the rule lives.
  previewSiteUrl: LOCAL_APP_URLS.web,
  shippingCarriers: ["se-1047082"],
};


