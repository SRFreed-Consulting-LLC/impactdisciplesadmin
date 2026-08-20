// Firebase EMULATOR SUITE configuration - used only by the test program
// (`npm run start-emu`, e2e-cross). Points every Firebase surface and every
// Cloud Function URL at the local emulators under the demo-impact project id
// (a `demo-` prefix is firebase-tools' convention for "no real project
// exists"), so nothing built with this configuration can touch
// impactdisciplesdev or prod. The apiKey is fake on purpose - the Auth
// emulator accepts any non-empty key.
//
// useEmulators is consumed by app.module.ts's provide* factories
// (connectFirestoreEmulator and friends); it exists (as false) in every
// other environment file so this one stays drop-in type-compatible.

const FN = "http://127.0.0.1:5001/demo-impact/us-central1";

export const environment = {
  production: false,
  useEmulators: true,
  firebaseConfig: {
    apiKey: "demo-api-key",
    authDomain: "demo-impact.firebaseapp.com",
    projectId: "demo-impact",
    storageBucket: "demo-impact.appspot.com",
    messagingSenderId: "0",
    appId: "1:0:web:demo",
  },
  domain: 'http://localhost:5200',
  session_expires: 30,
  freeEbookUrl: "https://example.test/free-ebook.pdf",
  shippingUrl: `${FN}/get_shipping_rates`,
  shippingLabelUrl: `${FN}/get_shipping_label`,
  unsubscribeUrl: `${FN}/unsubscribe_from_email_list`,
  publicSiteUrl: "http://localhost:4200",
  youtubeVideosUrl: `${FN}/get_youtube_videos`,
  application: "admin",
  shippingCarriers: ["se-0000000"],
};
