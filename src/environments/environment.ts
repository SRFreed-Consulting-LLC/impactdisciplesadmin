import { FIREBASE_PROJECTS, LOCAL_APP_URLS, functionUrl } from '@impact-common/shared/config/firebase-projects';

export const environment = {
  production: false,
  useEmulators: false,
  firebaseConfig: FIREBASE_PROJECTS.dev,
  // Admin's own dev server, not web's. This said 4200 - the web app's
  // port and Angular's default - until the port rule landed 2026-08-26.
  domain: LOCAL_APP_URLS.admin,
  session_expires: 30,
  freeEbookUrl: "https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8.appspot.com/o/EBooks%2FM-7-Journal.pdf?alt=media&token=50e3282f-6fa1-46aa-ad3a-a486e4024af1",
  shippingUrl: functionUrl('dev', 'get_shipping_rates'),
  shippingLabelUrl: functionUrl('dev', 'get_shipping_label'),
  unsubscribeUrl: functionUrl('dev', 'unsubscribe_from_email_list'),
  publicSiteUrl: "https://impactdisciplesdev-public.web.app",
  youtubeVideosUrl: functionUrl('dev', 'get_youtube_videos'),
  application: "admin",
  shippingCarriers: ["se-1047625"],
};


