import { TestBed } from '@angular/core/testing';
import { EmailBrandDefaultsService } from './email-brand-defaults.service';
import { WebConfigService } from './data/web-config.service';

// The organisation's own details, applied to newly dropped Social/Footer
// blocks. Before this, a Social block arrived with three networks and EMPTY
// urls and a Footer with no address - so emails went out with dead icons and
// no postal address, which commercial email is required to carry.
describe('EmailBrandDefaultsService', () => {
  let config: Record<string, unknown>[];

  const make = (): EmailBrandDefaultsService => {
    TestBed.configureTestingModule({
      providers: [
        EmailBrandDefaultsService,
        { provide: WebConfigService, useValue: { getAll: () => Promise.resolve(config) } }
      ]
    });
    return TestBed.inject(EmailBrandDefaultsService);
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    config = [{
      facebook: 'https://facebook.com/ImpactDiscipleship/',
      instagram: 'https://instagram.com/impactdisciples/',
      twitter: 'https://twitter.com/ImpactDisciples',
      youtube: 'https://youtube.com/@impactdisciples',
      email: 'info@impactdisciples.com',
      phone: '6788549322',
      address: { address1: '2564 HWY 154', address2: '', city: 'Newnan', state: 'GA', zip: '30265' }
    }];
  });

  describe('socialLinks', () => {
    it('maps every network the org has actually set', async () => {
      const links = await make().socialLinks();
      expect(links.map((l) => l.network)).toEqual(['facebook', 'instagram', 'x', 'youtube']);
      expect(links[0].url).toBe('https://facebook.com/ImpactDiscipleship/');
    });

    it("reads config's `twitter` field into the model's 'x' network", async () => {
      // The field predates the rename and still holds a twitter.com url.
      const x = (await make().socialLinks()).find((l) => l.network === 'x');
      expect(x?.url).toBe('https://twitter.com/ImpactDisciples');
    });

    it('OMITS a network with no url rather than linking to nothing', async () => {
      // An icon linking to "" is worse than no icon at all.
      config[0]['youtube'] = '';
      config[0]['instagram'] = null;
      const links = await make().socialLinks();
      expect(links.map((l) => l.network)).toEqual(['facebook', 'x']);
    });

    it('returns nothing when config is missing entirely', async () => {
      config = [];
      expect(await make().socialLinks()).toEqual([]);
    });
  });

  describe('addressHtml', () => {
    it('builds the postal address and contact line from config', async () => {
      const html = await make().addressHtml();
      expect(html).toContain('Impact Discipleship Ministries');
      expect(html).toContain('2564 HWY 154');
      expect(html).toContain('Newnan, GA 30265');
      expect(html).toContain('mailto:info@impactdisciples.com');
    });

    it('formats a ten-digit phone the way a person reads it', async () => {
      expect(await make().addressHtml()).toContain('(678) 854-9322');
    });

    it('leaves out an empty address2 rather than stranding a comma', async () => {
      const html = await make().addressHtml();
      expect(html).not.toContain('154,');
    });

    it('degrades to an empty string with no config, never to broken markup', async () => {
      config = [];
      expect(await make().addressHtml()).toBe('');
    });
  });
});
