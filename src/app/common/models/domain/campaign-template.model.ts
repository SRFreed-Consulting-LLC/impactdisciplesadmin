import { CampaignType } from './campaign.model';

// A gallery recipe: the preset a new campaign starts from. "Use this
// template" copies `defaults` into a fresh draft CampaignModel - a starting
// point, never a live link (editing the campaign afterward touches nothing
// here).
//
// v1 keeps these as seeded constants below rather than a Firestore
// collection - there's no admin screen for editing recipes yet, and a const
// ships the gallery with zero data setup. If/when recipes need to be
// admin-editable, promote this to a `campaign_templates` collection with
// these six as the seed docs (planned follow-up on the
// feature/campaign-manager branch), keeping this same interface.
export interface CampaignTemplate {
  name: string;
  type: CampaignType;
  description: string;
  defaults: {
    subject?: string;
    message?: string;
    headline?: string;
    supportingText?: string;
    thankYouMessage?: string;
    placement?: string;
  };
}

export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  {
    name: 'Product Spotlight',
    type: 'product',
    description: 'One product, one email, optional coupon.',
    defaults: {
      subject: '[Product] is here',
      message: 'Take a look at our newest addition to the store.'
    }
  },
  {
    name: 'New Arrival',
    type: 'product',
    description: 'Announcement-first, no discount - for launches that don\'t need one.',
    defaults: {
      subject: 'Just arrived in the store',
      message: 'See what\'s new at Impact Disciples.'
    }
  },
  {
    name: 'Event Countdown',
    type: 'event',
    description: 'Registration push with the deadline front and center.',
    defaults: {
      subject: 'Time is running out to register',
      message: 'Spots are filling up - register today.'
    }
  },
  {
    name: 'Last Chance',
    type: 'event',
    description: 'Final-days reminder for an event already being promoted.',
    defaults: {
      subject: 'Last chance to register',
      message: 'Registration closes soon. Don\'t miss it.'
    }
  },
  {
    name: 'Discount for Email',
    type: 'lead-capture',
    description: 'A coupon code in exchange for name + email.',
    defaults: {
      headline: 'Get 10% off your first order',
      supportingText: 'Join our email list and we\'ll send your code right away.',
      thankYouMessage: 'Check your inbox - your code is on the way.',
      placement: '/welcome'
    }
  },
  {
    name: 'Free Resource',
    type: 'lead-capture',
    description: 'Same capture flow, with a free resource as the incentive.',
    defaults: {
      headline: 'Get our free study guide',
      supportingText: 'Join our email list and we\'ll send it right over.',
      thankYouMessage: 'Check your inbox - it\'s on the way.',
      placement: '/resources'
    }
  }
];
