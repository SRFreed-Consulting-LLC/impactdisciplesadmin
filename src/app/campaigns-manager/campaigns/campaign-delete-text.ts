import { CampaignModel } from 'src/app/common/models/domain/campaign.model';
import { CampaignDeletePlan } from 'src/app/common/services/data/campaign.service';

// The confirm-dialog copy for deleting a campaign - shared by the list row
// action and the detail header button so both say exactly the same thing.
export function describeCampaignDelete(campaign: CampaignModel, plan: CampaignDeletePlan): string {
  const parts: string[] = [];
  if (plan.emailCount > 0) {
    parts.push(`its ${plan.emailCount} email${plan.emailCount === 1 ? '' : 's'}` +
      (plan.publishedCount > 0 ? ` (${plan.publishedCount} currently shown on the website)` : ''));
  }
  if (plan.hasPopup) {
    parts.push('its web popup');
  }
  const removes = parts.length ? ` This also removes ${parts.join(' and ')}.` : '';
  return `<i>Delete the campaign <b>${escapeHtml(campaign.name)}</b>?</i>${removes}` +
    ' Send history and stats for it are lost. This cannot be undone.';
}

function escapeHtml(text: string): string {
  return (text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
