import {onRequest} from "firebase-functions/v2/https";
import {restrictedCors, requireStaffAuth} from "./utils/security.functions";

/**
 * Shared implementation for both exports below: fetches the podcast
 * YouTube playlist server-side and returns only the resulting video items.
 * The YouTube Data API key (GOOGLE_SECRET_KEY) and playlist id
 * (YOUTUBE_PLAYLIST_KEY) never leave the server -- this replaces the old
 * get_youtube_keys, which handed the raw API key back to the browser
 * (where it landed in client JS and request URLs).
 * @param {any} response The Express-style response to write to.
 * @return {Promise<void>} Resolves once a response has been sent.
 */
async function fetchAndSendPlaylistVideos(response): Promise<void> {
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
}

// Staff-gated: only a signed-in admin's own Firebase Auth session may call
// this. This is what the admin app's own podcast-management page uses.
exports.get_youtube_videos = onRequest(
  {secrets: ["GOOGLE_SECRET_KEY", "YOUTUBE_PLAYLIST_KEY"]},
  (request, response) => {
    return restrictedCors(request, response, async () => {
      try {
        await requireStaffAuth(request);
      } catch {
        response.status(401).send({code: 401, error: "Unauthorized"});
        return;
      }

      await fetchAndSendPlaylistVideos(response);
    });
  });

// Public counterpart for impactdisciples-web's own public /podcasts page,
// which has no Firebase Auth session to gate on. Was previously calling a
// long-retired function (get_youtube_keys) that no longer exists -- the
// podcast page has been silently broken client-side ever since that
// function was replaced by the staff-gated one above, since a fully public
// page can never satisfy requireStaffAuth. Deliberately a *separate*
// export, not a loosening of get_youtube_videos's own auth requirement --
// the admin app's internal use of that one is untouched. The playlist
// video list itself is not sensitive (it's the same content already
// public on YouTube); only the API key needed protecting, and this keeps
// it server-side exactly the same way the staff-gated version does.
exports.get_youtube_videos_public = onRequest(
  {secrets: ["GOOGLE_SECRET_KEY", "YOUTUBE_PLAYLIST_KEY"]},
  (request, response) => {
    return restrictedCors(request, response, async () => {
      await fetchAndSendPlaylistVideos(response);
    });
  });
