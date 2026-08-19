import { Timestamp } from 'firebase/firestore';
import { BaseModel } from '../base.model';

// The actual email body behind a CampaignModel of type 'email' - kept in
// its own `campaign_emails` collection (SAME doc id as the campaign doc)
// so the ~25KB of html per sent email never rides along on campaign list
// pages; it's fetched on demand only (Sent Emails preview, the designer
// picker's Past Emails cards, "open in designer"). Imported from Mailchimp
// by scripts/import-mailchimp-campaigns.js; future in-app one-time sends
// can write the same pair.
export class CampaignEmailModel extends BaseModel {
  campaignId = '';
  subject = '';
  // The full rendered email document as sent (its own <html>/<head>/<body>)
  // - NOT builder-compiled output. Wrap through createDesignFromFullHtml()
  // before handing it to the designer.
  html = '';
  source?: 'mailchimp' | null;
  capturedAt?: Timestamp | Date | string | null;
}
