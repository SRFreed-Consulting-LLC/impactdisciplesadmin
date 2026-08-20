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
  const images = plan.imageCandidates > 0
    ? ` Of the ${plan.imageCandidates} stored image${plan.imageCandidates === 1 ? '' : 's'} it uses, any not used anywhere else will be deleted from storage too.`
    : '';
  return `<i>Delete the campaign <b>${escapeHtml(campaign.name)}</b>?</i>${removes}${images}` +
    ' Send history and stats for it are lost. This cannot be undone.';
}

// Post-delete summary for the snackbar.
export function describeCampaignDeleteResult(result: { emailsDeleted: number; imagesDeleted: string[]; imagesKept: string[]; imagesFailed: string[] }): string {
  const bits = ['Campaign deleted'];
  if (result.imagesDeleted.length) {
    bits.push(`${result.imagesDeleted.length} unused image${result.imagesDeleted.length === 1 ? '' : 's'} removed`);
  }
  if (result.imagesKept.length) {
    bits.push(`${result.imagesKept.length} still used elsewhere kept`);
  }
  if (result.imagesFailed.length) {
    bits.push(`${result.imagesFailed.length} image delete(s) failed - see function logs`);
  }
  return bits.join(' · ');
}

function escapeHtml(text: string): string {
  return (text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
