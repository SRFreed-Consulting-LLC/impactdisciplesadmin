# Mailchimp sunset scripts (archived 2026-08-20)

One-time scripts that carried the app off Mailchimp (Campaign Manager v2, Phase 7).
All have been run on dev AND prod; kept for the record / re-runs only. Every one is
dry-run by default and needs `--project=<dev|prod>`; the ones that call the Mailchimp
API need `MAILCHIMP_API_KEY` in the environment (the Secret Manager copy was removed
after the sunset - get a key from the Mailchimp account if it is still open).

| script | what it did | needs Mailchimp key |
|---|---|---|
| import-mailchimp-templates.js | saved templates -> mail_templates | yes |
| import-mailchimp-campaigns.js | 477 sent campaigns -> campaigns + campaign_emails | yes |
| propose-campaign-regroup.js / apply-campaign-regroup.js | 1:1 imports -> 78 real campaigns | no |
| backfill-newsletter-archive.js | legacy monthly-newsletter rows -> publishToWeb flags | yes |
| rehost-mailchimp-images.js | Mailchimp-CDN images -> our bucket, docs rewritten | no |
| reconcile-mailchimp-audience.js | audience -> customers flags (import/unflag/flag) | yes (--fetch) |

Outputs (proposals, backups, exports, the rehost map) live in `scripts/output/` (gitignored).
Full narrative: MIGRATION.md ("Mailchimp sunset", "Public newsletter archive").
