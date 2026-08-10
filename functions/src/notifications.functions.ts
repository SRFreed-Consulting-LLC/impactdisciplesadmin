import {onCall} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {getMessaging} from "firebase-admin/messaging";
import admin = require("firebase-admin");
import {requireAdminRole} from "./admin-users.functions";

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

// Callable, not onRequest -- no CORS wrapper needed (the callable framework
// handles that itself), and the Firebase client SDK already attaches the
// caller's own ID token for us, verified into request.auth before this
// handler runs. Previously had no auth check at all: anyone who knew this
// callable's name could push an arbitrary FCM notification (title/body/
// token fully attacker-controlled) to any device token. Reuses
// admin-users.functions.ts's existing requireAdminRole as-is, same
// Admin-only bar as creating/deleting admin accounts.
export const sendNotification = onCall(async (request) => {
  await requireAdminRole(request.auth?.uid);

  const message = {
    token: request.data.token,
    notification: {
      title: request.data.title,
      body: request.data.body,
      imageUrl: "https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8.appspot.com/o/Icons%2Ficon-72x72.png",
    },
  };

  getMessaging().send(message)
    .then((response) => {
      // Response is a message ID string.
      logger.info("Successfully sent message", message);
      logger.info("Successfully response", response);
    })
    .catch((error) => {
      logger.error("Error sending message:", error);
    });
});


