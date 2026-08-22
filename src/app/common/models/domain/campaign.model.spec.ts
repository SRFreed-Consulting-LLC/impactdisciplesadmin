import { Timestamp } from 'firebase/firestore';
import {
  CampaignModel,
  campaignKindLabel,
  channelLabel,
  effectiveStatus,
  emptyCampaignStats,
  emptyEmailStats,
} from './campaign.model';

// Pure domain logic, so no TestBed and no DI - house style (see
// permission.service.spec.ts). Everything here is a plain object cast to
// the model; only the fields each function reads are populated.
//
// effectiveStatus is the interesting one: it exists so nobody has to race
// the clock flipping campaigns off, which means it is time-dependent, and
// time-dependent logic is exactly what rots silently. It is the rule the
// Campaigns list, the Status Board and "live now" all agree through.

const DAY = 24 * 60 * 60 * 1000;
const at = (offsetMs: number) => Timestamp.fromDate(new Date(Date.now() + offsetMs));

function campaign(partial: Partial<CampaignModel>): CampaignModel {
  return partial as CampaignModel;
}

describe('campaign.model', () => {
  describe('effectiveStatus', () => {
    it('leaves a draft alone even when its end date has passed', () => {
      // The past-end-date rule deliberately exempts drafts - a draft nobody
      // ever sent should not present itself as a finished campaign.
      const c = campaign({ status: 'draft', startDate: at(-10 * DAY), endDate: at(-DAY) });
      expect(effectiveStatus(c)).toBe('draft');
    });

    it('reports ended when the stored status says so', () => {
      const c = campaign({ status: 'ended', startDate: at(-10 * DAY), endDate: at(10 * DAY) });
      expect(effectiveStatus(c)).toBe('ended');
    });

    it('reports ended once the end date is in the past, whatever the stored status', () => {
      const c = campaign({ status: 'live', startDate: at(-10 * DAY), endDate: at(-DAY) });
      expect(effectiveStatus(c)).toBe('ended');
    });

    it('promotes a scheduled campaign to live once its start date arrives', () => {
      const c = campaign({ status: 'scheduled', startDate: at(-DAY), endDate: at(10 * DAY) });
      expect(effectiveStatus(c)).toBe('live');
    });

    it('leaves a scheduled campaign scheduled while its start is still ahead', () => {
      const c = campaign({ status: 'scheduled', startDate: at(DAY), endDate: at(10 * DAY) });
      expect(effectiveStatus(c)).toBe('scheduled');
    });

    it('passes a live campaign through untouched inside its window', () => {
      const c = campaign({ status: 'live', startDate: at(-DAY), endDate: at(DAY) });
      expect(effectiveStatus(c)).toBe('live');
    });

    it('treats a missing end date as open-ended rather than ended', () => {
      const c = campaign({ status: 'live', startDate: at(-DAY) });
      expect(effectiveStatus(c)).toBe('live');
    });

    it('does not promote a scheduled campaign that has no start date at all', () => {
      const c = campaign({ status: 'scheduled' });
      expect(effectiveStatus(c)).toBe('scheduled');
    });
  });

  describe('campaignKindLabel', () => {
    it('uses the otherKind flavour when the goal is other', () => {
      expect(campaignKindLabel(campaign({ goal: 'other', otherKind: 'newsletter' })))
        .toBe('NEWSLETTER');
      expect(campaignKindLabel(campaign({ goal: 'other', otherKind: 'prayer-letter' })))
        .toBe('PRAYER LETTER');
    });

    it('falls back to the goal label when other has no flavour', () => {
      expect(campaignKindLabel(campaign({ goal: 'other' }))).toBe('OTHER');
    });

    it('uses the goal label for product and event campaigns', () => {
      expect(campaignKindLabel(campaign({ goal: 'product' }))).toBe('PRODUCT');
      expect(campaignKindLabel(campaign({ goal: 'event' }))).toBe('EVENT');
    });

    it('falls back to OTHER for an unrecognised goal rather than rendering undefined', () => {
      expect(campaignKindLabel(campaign({ goal: 'nonsense' as never }))).toBe('OTHER');
    });
  });

  describe('channelLabel', () => {
    it('renders twitter as X while the stored value stays twitter', () => {
      // The platform renamed; the stored value deliberately did not, so the
      // ?csrc attribution vocabulary and existing docs never fork.
      expect(channelLabel('twitter')).toBe('X');
    });

    it('labels the remaining channels', () => {
      expect(channelLabel('email')).toBe('EMAIL');
      expect(channelLabel('web')).toBe('WEB');
      expect(channelLabel('facebook')).toBe('FACEBOOK');
      expect(channelLabel('instagram')).toBe('INSTAGRAM');
    });

    it('upper-cases an unknown channel instead of returning undefined', () => {
      expect(channelLabel('mastodon' as never)).toBe('MASTODON');
    });
  });

  describe('empty stat factories', () => {
    it('emptyEmailStats starts every counter at zero', () => {
      const stats = emptyEmailStats();
      for (const [key, value] of Object.entries(stats)) {
        expect(value)
          .withContext(`${key} should start at 0`)
          .toBe(0);
      }
    });

    it('emptyCampaignStats covers every email stat plus the campaign-only ones', () => {
      const campaignStats = emptyCampaignStats();
      for (const key of Object.keys(emptyEmailStats())) {
        expect(campaignStats)
          .withContext(`campaign stats should carry ${key}`)
          .toEqual(jasmine.objectContaining({ [key]: 0 }));
      }
      expect(campaignStats.revenue).toBe(0);
      expect(campaignStats.purchases).toBe(0);
    });

    it('returns a fresh object each call, so one campaign cannot mutate another', () => {
      const a = emptyCampaignStats();
      const b = emptyCampaignStats();
      a.sent = 99;
      expect(b.sent).toBe(0);
    });
  });
});
