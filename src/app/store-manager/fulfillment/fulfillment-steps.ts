import { FulfillmentStatus } from 'src/app/common/models/utils/cart.model';

// Segmented Progress Bar concept (option 4) from the reviewed mockup -
// https://claude.ai/code/artifact/6d7ac162-4588-40cf-b4b6-243051aa1045 -
// the 5 segments the bar always renders, one per FulfillmentStatus. Same
// {id/label}-array shape already used by nav-config.ts's NavLeaf and
// theme.service.ts's COLOR_THEMES.
//
// 'received' -> 'closed' is a valid direct jump (pickup/hand-delivery
// override, skips shipping_label_printed/awaiting_shipping entirely) - an
// order that took that path shows every segment as done once closed, same
// as one that walked every step, since closed orders drop out of this
// screen immediately anyway (see fulfillment.component.ts).
export interface FulfillmentStep {
  status: FulfillmentStatus;
  label: string; // what produced this status, e.g. "Shipping Label Printed"
  statusLabel: string; // the status name itself, shown under the bar
}

export const FULFILLMENT_STEPS: FulfillmentStep[] = [
  { status: 'new', label: 'New Purchase Order Received', statusLabel: 'New' },
  { status: 'received', label: 'Order Acknowledged', statusLabel: 'Received' },
  { status: 'shipping_label_printed', label: 'Shipping Label Printed', statusLabel: 'Shipping Label Printed' },
  { status: 'awaiting_shipping', label: 'Product Packaged', statusLabel: 'Awaiting Shipping' },
  { status: 'closed', label: 'Product Shipped', statusLabel: 'Closed' }
];

// How many of the 5 steps are fully done for a given status - i.e. how many
// steps precede the one the order is currently sitting at. e.g. 'received'
// (array index 1) means step 1 ("New") is done (1), so the bar shows 1
// filled segment and segment index 1 ("Received") - the order's own current
// status - as the current one. Deliberately NOT index+1: the order's own
// status is still in progress, not done yet, so its segment must render as
// "current" (not "done") - a freshly-arrived 'new' order (array index 0)
// has 0 completed steps, showing "New" as current and everything else
// pending, not "New" done + "Received" current.
export function completedStepCount(status: FulfillmentStatus | undefined): number {
  if (!status) {
    return 0;
  }
  const index = FULFILLMENT_STEPS.findIndex((s) => s.status === status);
  return index === -1 ? 0 : index;
}

// Per-segment render state for the bar - shared between FulfillmentComponent
// (the real, actionable workflow) and DashboardComponent's read-only Recent
// Orders preview, so both render identical bars off one definition instead
// of two copies drifting apart.
export function segmentState(status: FulfillmentStatus | undefined, index: number): 'done' | 'current' | 'pending' {
  const completed = completedStepCount(status);
  if (index < completed) return 'done';
  if (index === completed) return 'current';
  return 'pending';
}
