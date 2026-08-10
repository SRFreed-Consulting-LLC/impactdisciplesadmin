import functions = require("firebase-functions");
import fetch = require("node-fetch");
import {Storage} from "@google-cloud/storage";
import {restrictedCors, requireStaffAuth} from "./utils/security.functions";


// Create a Google Cloud Storage instance
const storage = new Storage();
const bucketName = "gs://impactdisciples-a82a8.appspot.com";

// No caller anywhere in impactdisciples-admin or impactdisciples-web --
// previously had no auth at all. Makes the server fetch an
// attacker-supplied URL (SSRF-adjacent) and upload the result into the
// public storage bucket under Blogs/, an unauthenticated storage-write/spam
// vector. Now requires a real staff Firebase Auth session, same as every
// other function that writes data on the caller's behalf.
exports.uploadImageToStorage = functions
  .https.onRequest((req, res) => {
    return restrictedCors(req, res, async () => {
      try {
        await requireStaffAuth(req);
      } catch (err) {
        res.status(401).send({success: false, message: "Unauthorized"});
        return;
      }

      const imageUrl = req.body.url;
      const imageName = "Blogs/" + req.body.name;

      try {
        // Fetch the image from the web
        const response = await fetch(imageUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.statusText}`);
        }

        // Read the image as a Buffer
        const buffer = await response.buffer();

        // Create a reference to the destination file in Cloud Storage
        const file = storage.bucket(bucketName).file(imageName);

        // Upload the image
        await file.save(buffer, {
          metadata: {
            contentType: response.headers.get("content-type"),
          },
        });

        res.send({success: true, message: file.publicUrl()});
      } catch (error) {
        console.error("Error uploading image:", error);
        res.send({success: false, message: error.message});
      }
    });
  });

