/* eslint-disable @typescript-eslint/no-var-requires */
import * as functions from "firebase-functions";
import {restrictedCors, requireStaffAuth} from "./utils/security.functions";

// Fetches the podcast YouTube playlist server-side and returns only the
// resulting video items. The YouTube Data API key (GOOGLE_SECRET_KEY) and
// playlist id (YOUTUBE_PLAYLIST_KEY) never leave the server -- this replaces
// the old get_youtube_keys, which handed the raw API key back to the browser
// (where it landed in client JS and request URLs). Still staff-gated: only a
// signed-in admin's own Firebase Auth session may call it.
exports.get_youtube_videos = functions
  .runWith({secrets: ["GOOGLE_SECRET_KEY", "YOUTUBE_PLAYLIST_KEY"]})
  .https.onRequest((request, response) => {
    return restrictedCors(request, response, async () => {
      try {
        await requireStaffAuth(request);
      } catch (err) {
        response.status(401).send({code: 401, error: "Unauthorized"});
        return;
      }

      const apiKey = process.env.GOOGLE_SECRET_KEY;
      const playlistId = process.env.YOUTUBE_PLAYLIST_KEY;
      const base = "https://www.googleapis.com/youtube/v3/playlistItems";

      try {
        const videos: unknown[] = [];
        let pageToken: string | undefined;

        do {
          let url = `${base}?key=${apiKey}` +
            "&part=snippet,contentDetails&maxResults=50" +
            `&playlistId=${playlistId}`;
          if (pageToken) {
            url += "&pageToken=" + pageToken;
          }

          const ytResponse = await fetch(url);
          if (!ytResponse.ok) {
            response.status(502).send({
              code: 502,
              error: "Failed to fetch playlist from YouTube",
            });
            return;
          }

          const result = await ytResponse.json() as {
            items?: unknown[];
            nextPageToken?: string;
          };

          if (Array.isArray(result.items)) {
            videos.push(...result.items);
          }
          pageToken = result.nextPageToken;
        } while (pageToken);

        response.send({videos});
      } catch (err) {
        console.log(String(err));
        response.status(500).send({code: 500, error: "Internal error"});
      }
    });
  });
