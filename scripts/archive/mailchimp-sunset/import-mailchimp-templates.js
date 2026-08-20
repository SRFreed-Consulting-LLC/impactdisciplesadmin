#!/usr/bin/env node
// One-time import of the Mailchimp account's SAVED templates into the email
// builder's template catalogue (mail_templates docs with a single-HTML-block
// design, so they preview faithfully and stay editable via the designer's
// HTML block).
//
// Mailchimp's API cannot export a builder template's HTML directly - the
// standard workaround is used instead: create a TEMP draft campaign from
// the template, read the campaign's rendered content, delete the campaign.
// The drafts are titled "temp-template-import (delete me)" and removed in
// a finally block even on failure.
//
// Usage:
//   $env:MAILCHIMP_API_KEY = (firebase functions:secrets:access MAILCHIMP_API_KEY --project impactdisciplesdev)
//   node scripts/archive/mailchimp-sunset/import-mailchimp-templates.js --project=dev [--execute]
// Without --execute it lists what WOULD be imported (dry run).

const {resolveProjectId, getFirestoreFor} = require("../../lib/firestore-admin");

const args = {};
for (const raw of process.argv.slice(2)) {
  if (!raw.startsWith("--")) continue;
  const eq = raw.indexOf("=");
  if (eq === -1) args[raw.slice(2)] = true;
  else args[raw.slice(2, eq)] = raw.slice(eq + 1);
}

const API_KEY = (process.env.MAILCHIMP_API_KEY || "").trim();
if (!API_KEY || !API_KEY.includes("-")) {
  console.error("Set MAILCHIMP_API_KEY (format xxxx-usNN) in the environment.");
  process.exit(1);
}
const DC = API_KEY.split("-").pop();
const BASE = `https://${DC}.api.mailchimp.com/3.0`;
const AUTH = "Basic " + Buffer.from("anystring:" + API_KEY).toString("base64");

/**
 * Mailchimp API call helper.
 * @param {string} method HTTP method.
 * @param {string} pathname API path.
 * @param {object} [body] JSON body.
 * @return {Promise<object|null>} Parsed response (null for 204).
 */
async function mc(method, pathname, body) {
  const response = await fetch(BASE + pathname, {
    method,
    headers: {"Authorization": AUTH, "Content-Type": "application/json"},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `${method} ${pathname} -> ${response.status}: ` +
      `${data?.detail ?? data?.title ?? "unknown"}`
    );
  }
  return data;
}

/**
 * Extracts the body content + any head <style> blocks from a full HTML
 * document, for embedding as an HTML block inside the builder's own email
 * skeleton (nesting a second <html> document would be invalid).
 * @param {string} fullHtml The campaign-rendered template HTML.
 * @return {string} Embeddable fragment.
 */
function extractEmbeddable(fullHtml) {
  const styles = [...fullHtml.matchAll(/<style[\s\S]*?<\/style>/gi)]
    .map((m) => m[0]).join("\n");
  const bodyMatch = fullHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : fullHtml;
  return (styles + "\n" + body)
    // Strip scripts and Mailchimp's merge-tag edit markers we don't use.
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .trim();
}

/** @return {string} A fresh uuid. */
function uid() {
  return require("crypto").randomUUID();
}

/**
 * Builds the builder-design document wrapping one full-width HTML block -
 * mirrors createDefaultDesign()/createBlock('html') in
 * src/app/common/models/admin/email-design.model.ts (plain-JS twin, same
 * reasoning as the other scripts' mirrors).
 * @param {string} embeddableHtml The extracted fragment.
 * @return {object} EmailDesign-shaped document.
 */
function designWithHtmlBlock(embeddableHtml) {
  const zero = {top: 0, right: 0, bottom: 0, left: 0};
  const blockStyles = () => ({
    padding: {...zero},
    margin: {...zero},
    border: null,
    borderRadius: {topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0},
    backgroundColor: null,
    align: "left",
  });
  const section = (kind, rows) => ({
    id: uid(), kind, name: null, backgroundColor: null, rows,
  });
  return {
    version: 1,
    contentWidth: 600,
    preheader: null,
    globalStyles: {
      desktop: {
        emailBackgroundColor: "#e9ecef",
        bodyBackgroundColor: "#ffffff",
        heading: {
          fontFamily: "Georgia, Times New Roman, serif",
          color: "#1f2430",
          sizes: {h1: 28, h2: 22, h3: 18, h4: 16},
        },
        paragraph: {
          fontFamily: "Helvetica, Arial, sans-serif",
          fontSize: 14, color: "#454d58", lineHeight: 1.6,
        },
        link: {color: "#0b5a5a", underline: true},
        button: {
          backgroundColor: "#1f3a5f", color: "#ffffff", borderRadius: 6,
          fontSize: 14, padding: {top: 12, right: 30, bottom: 12, left: 30},
        },
        divider: {style: "solid", color: "#dfe3e8", thickness: 1},
      },
      mobile: {},
    },
    sections: [
      section("header", []),
      section("body", [{
        id: uid(),
        columns: [{
          id: uid(),
          widthPercent: 100,
          blocks: [{
            id: uid(),
            type: "html",
            styles: blockStyles(),
            mobileStyles: {},
            stylesLinked: true,
            hidden: false,
            hideOnMobile: false,
            hideOnDesktop: false,
            props: {html: embeddableHtml},
          }],
        }],
        styles: blockStyles(),
        mobileStyles: {},
        stylesLinked: true,
      }]),
      section("footer", []),
    ],
  };
}

(async () => {
  const projectId = resolveProjectId(args.project);
  const db = getFirestoreFor(projectId);
  const execute = !!args.execute;

  // Saved (user-created) templates only - not Mailchimp's base catalog.
  const list = await mc("GET", "/templates?type=user&count=200");
  const templates = (list.templates ?? [])
    .filter((t) => !t.name.startsWith("temp-template-import"));
  console.log(`Found ${templates.length} saved template(s) in Mailchimp (${DC}).`);

  const existingSnap = await db.collection("mail_templates").get();
  const existingNames = new Set(existingSnap.docs.map((d) => d.data().name));

  const listId = (await mc("GET", "/lists?count=1")).lists?.[0]?.id;
  if (!listId) throw new Error("No Mailchimp audience found for the temp-campaign trick.");

  // Templates whose content the classic temp-campaign trick can't render
  // (new-builder "multichannel" templates - their content is NOT exposed by
  // Mailchimp's public API at all, probed 2026-08-18). They fall through to
  // the sent-campaign title-match pass below.
  const unexportable = [];

  for (const template of templates) {
    const name = `${template.name.trim()} (Mailchimp)`;
    if (existingNames.has(name)) {
      console.log(`SKIP (already imported): ${name}`);
      continue;
    }
    if (!execute) {
      console.log(`WOULD IMPORT: ${template.name} (id ${template.id}, type ${template.type})`);
      continue;
    }

    let campaignId;
    try {
      const campaign = await mc("POST", "/campaigns", {
        type: "regular",
        recipients: {list_id: listId},
        settings: {
          subject_line: "temp",
          title: "temp-template-import (delete me)",
          from_name: "temp",
          reply_to: "noreply@impactdisciples.com",
          template_id: template.id,
        },
      });
      campaignId = campaign.id;
      const content = await mc("GET", `/campaigns/${campaignId}/content`);
      if (!(content?.html ?? "").trim()) {
        // New-builder template - queue for the sent-campaign pass.
        unexportable.push(template);
        continue;
      }
      const embeddable = extractEmbeddable(content.html);
      await db.collection("mail_templates").add({
        name,
        subject: "",
        html: content.html,
        attachments: [],
        design: designWithHtmlBlock(embeddable),
      });
      console.log(`IMPORTED (exact): ${name}`);
    } catch (err) {
      console.log(`FAILED: ${template.name} - ${err.message}`);
    } finally {
      if (campaignId) {
        await mc("DELETE", `/campaigns/${campaignId}`).catch(() => undefined);
      }
    }
  }

  // ---- Fallback: new-builder templates via their SENT campaigns.
  // Mailchimp's API does not expose new-builder template content, but sent
  // campaigns DO return full rendered html - and these templates are
  // newsletters that were sent. Match template name <-> campaign title
  // (normalized), newest campaign wins. Approximation, clearly reported.
  if (execute && unexportable.length > 0) {
    console.log(`\n${unexportable.length} new-builder template(s) - trying sent-campaign match...`);
    const normalize = (value) => (value ?? "")
      .toLowerCase().replace(/\(copy \d+\)/g, "").replace(/[^a-z0-9]/g, "");

    // Hand-verified template-name -> sent-campaign-title pairs where the
    // automatic normalization can't see the correspondence (checked against
    // the account's real campaign list, 2026-08-18). Only confident pairs -
    // anything ambiguous stays unimported rather than mislabeled.
    const EXPLICIT_CAMPAIGN_MAP = {
      "April Newsletter 2025": "Newsletter April 2025",
      "DM June Newsletter": "June 2025 Newsletter",
      "DM July Prayer Newsletter": "JULY 2025 PRAYER LETTER",
      "DM September Prayer Newsletter": "Prayer Newsletter SEPT 2025",
      "DM November Prayer Newsletter": "November 2025 Prayer Letter",
      "EOY25 - DEC": "End of Year GIving 2025",
      "5 Days to DMSUMMIT": "5 Days to Go! Disciple-Making Summit 2026",
      "DM FEB Prayer Newsletter": "FEB Prayer letter",
      "DM March Newsletter": "March Newsletter- Going beyond impact one",
    };
    const sent = await mc("GET",
      "/campaigns?status=sent&count=300&sort_field=send_time&sort_dir=DESC" +
      "&fields=campaigns.id,campaigns.settings.title," +
      "campaigns.settings.subject_line,campaigns.send_time");
    const campaigns = sent.campaigns ?? [];

    for (const template of unexportable) {
      const name = `${template.name.trim()} (Mailchimp)`;
      const wanted = normalize(template.name);
      if (!wanted) continue;
      const explicit = EXPLICIT_CAMPAIGN_MAP[template.name.trim()];
      const match = explicit ?
        campaigns.find((campaign) =>
          normalize(campaign.settings?.title) === normalize(explicit)) :
        campaigns.find((campaign) => {
          const title = normalize(campaign.settings?.title);
          return title && (title === wanted ||
            title.includes(wanted) || wanted.includes(title));
        });
      if (!match) {
        console.log(`NO MATCH (not exportable): ${template.name}`);
        continue;
      }
      try {
        const content = await mc("GET", `/campaigns/${match.id}/content`);
        if (!(content?.html ?? "").trim()) {
          console.log(`NO HTML on matched campaign: ${template.name}`);
          continue;
        }
        await db.collection("mail_templates").add({
          name,
          subject: match.settings?.subject_line ?? "",
          html: content.html,
          attachments: [],
          design: designWithHtmlBlock(extractEmbeddable(content.html)),
        });
        console.log(`IMPORTED (from sent campaign "${match.settings?.title}"): ${name}`);
      } catch (err) {
        console.log(`FAILED (campaign content): ${template.name} - ${err.message}`);
      }
    }
  }
  console.log(execute ? "Done." : "Dry run done - rerun with --execute to import.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
