export const environment = {
  production: false,
  firebaseConfig: {
    apiKey: "AIzaSyDRfdv2XgpLQ-ll2oxpEEMyhtC75rzkP4c",
    authDomain: "impactdisciplesdev.firebaseapp.com",
    projectId: "impactdisciplesdev",
    storageBucket: "impactdisciples-a82a8.appspot.com",
    messagingSenderId: "562759240809",
    appId: "1:562759240809:web:7d6fa117db35b887b6a6f8",
    measurementId: "G-KJL13HB8DV"
  },
  domain: 'http://localhost:4200',
  session_expires: 30,
  stripeKey: "pk_test_51IP8IBC4Pv6WfeJrdtjF5O4PsGZ4iCtIHV0QdUXya0hZZph4guaxLrR83RCiLMIkcCm5RdkuMVDCz1axYQyBfaWH00nFnZhjrl",
  freeEbookUrl: "https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8.appspot.com/o/EBooks%2FM-7-Journal.pdf?alt=media&token=50e3282f-6fa1-46aa-ad3a-a486e4024af1",
  stripeCancelURL: "https://us-central1-impactdisciplesdev.cloudfunctions.net/cancel_payment_intent",
  stripeRefundURL: "https://us-central1-impactdisciplesdev.cloudfunctions.net/refund_payment",
  shippingUrl: "https://us-central1-impactdisciplesdev.cloudfunctions.net/get_shipping_rates",
  shippingLabelUrl: "https://us-central1-impactdisciplesdev.cloudfunctions.net/get_shipping_label",
  unsubscribeUrl: "https://us-central1-impactdisciplesdev.cloudfunctions.net/unsubscribe_from_email_list",
  youtubeKeyUrl: "https://us-central1-impactdisciplesdev.cloudfunctions.net/get_youtube_keys",
  application: "admin",
  shippingCarriers: ["se-1047625"],
};


