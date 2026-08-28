import { Router } from '@angular/router';
import { CampaignModel } from 'src/app/common/models/domain/campaign.model';
import { CampaignService } from 'src/app/common/services/data/campaign.service';
import { ConfirmService } from '../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../shared/snackbar.service';
import {
  describeCampaignDelete,
  describeCampaignDeleteResult
} from './campaigns/campaign-delete-text';

/**
 * The two campaign flows that were written out more than once.
 *
 * Sweep finding R1. The one-live-campaign gate existed twice (the wizard's
 * save, and activate on the detail screen) and its wording had ALREADY
 * drifted - one copy said "End that campaign first, or add what you need
 * to it instead", the other "End that one first". The delete flow existed
 * twice, verbatim, differing only in what each screen does afterwards.
 *
 * These are plain functions taking their dependencies rather than a
 * service, because what they mostly do is UI - confirm, navigate, snackbar
 * - which does not belong on a data service. The write-side invariants
 * (the activate batch, the end cascade) DID move onto CampaignService; see
 * activateTo() and endCascade() there.
 */

/** The thing a campaign promotes, or null when its goal has no target. */
export function campaignTargetId(campaign: {
  goal?: string | null;
  productId?: string | null;
  eventId?: string | null;
}): string | null {
  if (campaign.goal === 'product') {
    return campaign.productId ?? null;
  }
  if (campaign.goal === 'event') {
    return campaign.eventId ?? null;
  }
  // goal 'other' - newsletters and the like - has no target and is never
  // constrained.
  return null;
}

/**
 * The "already promoted" message. One wording, so the two callers cannot
 * drift apart again.
 */
export function describeLiveHolder(
  holderName: string,
  goal: string | null | undefined
): string {
  const noun = goal === 'product' ? 'product' : 'event';
  return `<b>${holderName}</b> is already live for this ${noun}, and only ` +
    'one campaign can promote it at a time. End that campaign first, or ' +
    'add what you need to it instead.<br><br>Open it now?';
}

export interface LiveTargetGateDeps {
  campaignService: CampaignService;
  confirmService: ConfirmService;
  router: Router;
}

/**
 * One live campaign per product/event.
 *
 * Returns true when the caller must STOP - another live campaign already
 * holds this target and the author has been told (and offered a jump to
 * it). Returns false when nothing is in the way.
 *
 * Advisory by design: it is a client-side check, so a script or import can
 * still create a second live campaign. It stops the mistake in the UI; it
 * does not make the invariant guaranteed.
 */
export async function liveTargetConflict(
  deps: LiveTargetGateDeps,
  campaign: {
    id?: string | null;
    goal?: string | null;
    productId?: string | null;
    eventId?: string | null;
  }
): Promise<boolean> {
  const holder = await deps.campaignService.findLiveCampaignFor(
    campaign.goal as CampaignModel['goal'],
    campaignTargetId(campaign),
    campaign.id
  );
  if (!holder) {
    return false;
  }

  const open = await deps.confirmService.confirm(
    describeLiveHolder(holder.name, campaign.goal),
    'Already promoted'
  );
  if (open) {
    deps.router.navigate(
      ['/campaigns-manager'],
      { queryParams: { tab: 'campaigns', campaignId: holder.id } }
    );
  }
  return true;
}

export interface CampaignDeleteDeps {
  campaignService: CampaignService;
  confirmService: ConfirmService;
  snackbar: SnackbarService;
}

/**
 * Plan, confirm and run a campaign delete.
 *
 * Returns true only when the campaign was actually deleted, so each screen
 * can do its own follow-up (the list reloads its pages, the detail screen
 * emits `deleted`) without that difference forcing two copies of the flow.
 *
 * Refuses while any of the campaign's emails are sending or scheduled -
 * the plan comes from the deleteCampaign callable's dry run, so what the
 * dialog promises is what the server will actually do.
 */
export async function runCampaignDelete(
  deps: CampaignDeleteDeps,
  campaign: CampaignModel
): Promise<boolean> {
  try {
    const plan = await deps.campaignService.planDelete(campaign.id!);
    if (plan.inFlight.length > 0) {
      deps.snackbar.error(
        'Cannot delete while emails are sending or scheduled: ' +
        plan.inFlight.join(', ')
      );
      return false;
    }

    const confirmed = await deps.confirmService.confirm(
      describeCampaignDelete(campaign, plan),
      'Delete Campaign'
    );
    if (!confirmed) {
      return false;
    }

    const result = await deps.campaignService.deleteCascade(campaign.id!);
    deps.snackbar.success(describeCampaignDeleteResult(result));
    return true;
  } catch (err) {
    deps.snackbar.error('Delete failed: ' + ((err as Error)?.message ?? err));
    return false;
  }
}
