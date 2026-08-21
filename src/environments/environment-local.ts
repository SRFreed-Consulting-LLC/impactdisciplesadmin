import { FIREBASE_PROJECTS, functionUrl } from '@impact-common/shared/config/firebase-projects';

export const environment = {
  production: false,
  useEmulators: false,
  firebaseConfig: FIREBASE_PROJECTS.dev,
  domain: 'http://localhost:5200',
  session_expires: 30,
  freeEbookUrl: "https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8.appspot.com/o/EBooks%2FM-7-Journal.pdf?alt=media&token=50e3282f-6fa1-46aa-ad3a-a486e4024af1",
  shippingUrl: functionUrl('dev', 'get_shipping_rates'),
  shippingLabelUrl: functionUrl('dev', 'get_shipping_label'),
  unsubscribeUrl: functionUrl('dev', 'unsubscribe_from_email_list'),
  publicSiteUrl: "https://impactdisciplesdev-public.web.app",
  youtubeVideosUrl: functionUrl('dev', 'get_youtube_videos'),
  application: "admin",
  shippingCarriers: ["se-1047082"],
};


