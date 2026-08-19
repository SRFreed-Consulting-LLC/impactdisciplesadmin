import { FulfillmentStatus, StatusHistoryEntry } from 'src/app/common/models/utils/cart.model';

// Segmented Progress Bar concept (option 4) from the reviewed mockup -
// https://claude.ai/code/artifact/6d7ac162-4588-40cf-b4b6-243051aa1045 -
// the segments the bar renders, one per step of the path the order is on.
// Same {id/label}-array shape already used by nav-config.ts's NavLeaf and
// theme.service.ts's COLOR_THEMES.
//
// TWO paths since 2026-08-19: the standard in-house path (label ->
// package -> ship) and the AMAZON branch taken from 'received' (Amazon
// ships it; the admin's final step is sending the customer their
// confirmation email, which closes the order). stepsFor() picks the right
// array per order. 'received' -> 'closed' also remains a valid direct
// jump (pickup/hand-delivery override, skips everything after).
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

export const AMAZON_FULFILLMENT_STEPS: FulfillmentStep[] = [
  { status: 'new', label: 'New Purchase Order Received', statusLabel: 'New' },
  { status: 'received', label: 'Order Acknowledged', statusLabel: 'Received' },
  { status: 'shipped_via_amazon', label: 'Shipped via Amazon', statusLabel: 'Shipped via Amazon' },
  { status: 'closed', label: 'Confirmation Email Sent', statusLabel: 'Closed' }
];

// Which path this order is on: the Amazon branch once its status is (or
// its recorded history ever passed through) 'shipped_via_amazon', else
// the standard path. History matters for CLOSED Amazon orders - their
// current status alone can't tell the paths apart.
export function stepsFor(
  status: FulfillmentStatus | undefined,
  history?: StatusHistoryEntry[]
): FulfillmentStep[] {
  const amazon = status === 'shipped_via_amazon' ||
    (history ?? []).some((entry) => entry.status === 'shipped_via_amazon');
  return amazon ? AMAZON_FULFILLMENT_STEPS : FULFILLMENT_STEPS;
}

// How many of the path's steps are fully done for a given status - i.e.
// how many steps precede the one the order is currently sitting at.
// Deliberately NOT index+1: the order's own status is still in progress,
// not done yet, so its segment must render as "current" (not "done").
export function completedStepCount(
  steps: FulfillmentStep[],
  status: FulfillmentStatus | undefined
): number {
  if (!status) {
    return 0;
  }
  const index = steps.findIndex((s) => s.status === status);
  return index === -1 ? 0 : index;
}

// Per-segment render state for the bar - shared between FulfillmentComponent
// (the real, actionable workflow), OrderWorkflowDialogComponent, and
// DashboardComponent's read-only Recent Orders preview, so all render
// identical bars off one definition instead of copies drifting apart.
export function segmentState(
  steps: FulfillmentStep[],
  status: FulfillmentStatus | undefined,
  index: number
): 'done' | 'current' | 'pending' {
  const completed = completedStepCount(steps, status);
  if (index < completed) return 'done';
  if (index === completed) return 'current';
  return 'pending';
}
