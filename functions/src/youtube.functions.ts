/* eslint-disable @typescript-eslint/no-var-requires */
import * as functions from "firebase-functions";
import {restrictedCors, requireStaffAuth} from "./utils/security.functions";

// NOTE: this still hands GOOGLE_SECRET_KEY/YOUTUBE_PLAYLIST_KEY back to
// whoever calls it -- requireStaffAuth below means that's now only ever a
// signed-in admin's own browser, not literally anyone, but the raw secret
// still reaches client-side JS. The deeper fix (redesign this to make the
// YouTube API call server-side and return only the resulting data) is
// tracked separately and deliberately not done here -- this pass is the
// minimal auth-gate, chosen over the bigger redesign.
exports.get_youtube_keys = functions
  .runWith({secrets: ["GOOGLE_SECRET_KEY", "YOUTUBE_PLAYLIST_KEY"]})
  .https.onRequest((request, response) => {
    return restrictedCors(request, response, async () => {
      try {
        await requireStaffAuth(request);
      } catch (err) {
        response.status(401).send({code: 401, error: "Unauthorized"});
        return;
      }

      response.send({api_key: process.env.GOOGLE_SECRET_KEY,
        playlist_key: process.env.YOUTUBE_PLAYLIST_KEY});
    });
  });
