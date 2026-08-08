/* eslint-disable @typescript-eslint/no-var-requires */
import * as functions from "firebase-functions";
import {restrictedCors} from "./utils/security.functions";

// NOTE: this function hands GOOGLE_SECRET_KEY/YOUTUBE_PLAYLIST_KEY back to
// any caller that gets past CORS -- i.e. any real browser hitting it from an
// allowed origin still receives the raw secret. CORS only blocks other
// *websites*, not a direct script/curl call with a forged Origin header, so
// this key should be treated as effectively public until this function is
// redesigned to make the YouTube API call server-side and return only the
// resulting data (see the audit follow-up list).
exports.get_youtube_keys = functions
  .runWith({secrets: ["GOOGLE_SECRET_KEY", "YOUTUBE_PLAYLIST_KEY"]})
  .https.onRequest((request, response) => {
    return restrictedCors(request, response, async () => {
      response.send({api_key: process.env.GOOGLE_SECRET_KEY,
        playlist_key: process.env.YOUTUBE_PLAYLIST_KEY});
    });
  });
