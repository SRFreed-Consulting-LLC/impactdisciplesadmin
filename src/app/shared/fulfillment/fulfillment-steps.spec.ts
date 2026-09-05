import {
  AMAZON_FULFILLMENT_STEPS,
  FULFILLMENT_STEPS,
  completedStepCount,
  segmentState,
  stepsFor,
} from './fulfillment-steps';
import { StatusHistoryEntry } from '@impact-common/shared/models/utils/cart.model';

// The fulfillment workflow's two paths (standard in-house vs Amazon) are
// told apart by stepsFor() - the dashboard workflow dialog, the
// Fulfillment screen, and the read-only Recent Orders bars all render off
// these three functions, so a regression here mis-draws every one of them.
describe('fulfillment-steps', () => {
  describe('stepsFor', () => {
    it('picks the standard path for ordinary statuses', () => {
      expect(stepsFor('new')).toBe(FULFILLMENT_STEPS);
      expect(stepsFor('received')).toBe(FULFILLMENT_STEPS);
      expect(stepsFor('awaiting_shipping')).toBe(FULFILLMENT_STEPS);
      expect(stepsFor(undefined)).toBe(FULFILLMENT_STEPS);
    });

    it('picks the Amazon path while sitting at shipped_via_amazon', () => {
      expect(stepsFor('shipped_via_amazon')).toBe(AMAZON_FULFILLMENT_STEPS);
    });

    it('keeps a CLOSED Amazon order on the Amazon path via its history', () => {
      const history = [
        { status: 'new' },
        { status: 'received' },
        { status: 'shipped_via_amazon' },
        { status: 'closed' },
      ] as StatusHistoryEntry[];
      expect(stepsFor('closed', history)).toBe(AMAZON_FULFILLMENT_STEPS);
    });

    it('a closed order with no Amazon history stays on the standard path', () => {
      const history = [
        { status: 'received' }, { status: 'closed' },
      ] as StatusHistoryEntry[];
      expect(stepsFor('closed', history)).toBe(FULFILLMENT_STEPS);
      expect(stepsFor('closed')).toBe(FULFILLMENT_STEPS);
    });
  });

  describe('completedStepCount', () => {
    it('counts the steps BEFORE the current one (current is in progress, not done)', () => {
      expect(completedStepCount(FULFILLMENT_STEPS, 'new')).toBe(0);
      expect(completedStepCount(FULFILLMENT_STEPS, 'received')).toBe(1);
      expect(completedStepCount(FULFILLMENT_STEPS, 'shipping_label_printed')).toBe(2);
      expect(completedStepCount(FULFILLMENT_STEPS, 'awaiting_shipping')).toBe(3);
      expect(completedStepCount(FULFILLMENT_STEPS, 'closed')).toBe(4);
    });

    it('unknown or missing status counts as nothing done', () => {
      expect(completedStepCount(FULFILLMENT_STEPS, undefined)).toBe(0);
      expect(completedStepCount(AMAZON_FULFILLMENT_STEPS, 'awaiting_shipping')).toBe(0);
    });
  });

  describe('segmentState', () => {
    it('classifies done / current / pending around the active step', () => {
      // Order sitting at awaiting_shipping (index 3 on the standard path).
      expect(segmentState(FULFILLMENT_STEPS, 'awaiting_shipping', 0)).toBe('done');
      expect(segmentState(FULFILLMENT_STEPS, 'awaiting_shipping', 2)).toBe('done');
      expect(segmentState(FULFILLMENT_STEPS, 'awaiting_shipping', 3)).toBe('current');
      expect(segmentState(FULFILLMENT_STEPS, 'awaiting_shipping', 4)).toBe('pending');
    });

    it('a brand-new order shows the first segment current, rest pending', () => {
      expect(segmentState(FULFILLMENT_STEPS, 'new', 0)).toBe('current');
      expect(segmentState(FULFILLMENT_STEPS, 'new', 1)).toBe('pending');
    });
  });

  describe('the step tables themselves', () => {
    it('both paths share the same first two steps and end closed', () => {
      expect(FULFILLMENT_STEPS[0].status).toBe('new');
      expect(AMAZON_FULFILLMENT_STEPS[0].status).toBe('new');
      expect(FULFILLMENT_STEPS[1].status).toBe('received');
      expect(AMAZON_FULFILLMENT_STEPS[1].status).toBe('received');
      expect(FULFILLMENT_STEPS[FULFILLMENT_STEPS.length - 1].status).toBe('closed');
      expect(AMAZON_FULFILLMENT_STEPS[AMAZON_FULFILLMENT_STEPS.length - 1].status).toBe('closed');
    });
  });
});
