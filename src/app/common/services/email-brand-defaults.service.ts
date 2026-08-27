import { Injectable, inject } from '@angular/core';
import { WebConfigService } from './data/web-config.service';
import { SocialNetwork, SocialNetworkLink } from 'src/app/common/models/admin/email-design.model';
import { environment } from 'src/environments/environment';

/**
 * The organisation's own details, for blocks that should arrive already
 * filled in.
 *
 * Why this exists: dropping a Social block gave you three networks with EMPTY
 * urls, and a Footer block an empty address - so every email either got the
 * same details typed in again by hand, or (more often) went out with dead
 * social icons and no postal address. Both are already stored: the socials
 * and the address live on the single `config` document, and the unsubscribe
 * endpoint is per-environment.
 *
 * The address matters beyond tidiness - a physical postal address in
 * commercial email is a CAN-SPAM requirement, and an empty footer block
 * silently omits it.
 *
 * Read through WebConfigService, which already caches the config fetch for
 * the app's session, so this costs no extra Firestore read.
 */
@Injectable({ providedIn: 'root' })
export class EmailBrandDefaultsService {
  private readonly webConfig = inject(WebConfigService);

  /**
   * Social links from config, in a stable order, EXCLUDING any network the
   * organisation has not set.
   *
   * Dropping a network we have no url for is the point: an icon linking to
   * "" is worse than no icon, and the block's own editor can still add one.
   */
  async socialLinks(): Promise<SocialNetworkLink[]> {
    const config = (await this.webConfig.getAll())[0];
    if (!config) {
      return [];
    }
    // `twitter` in config, 'x' in the design model - the field predates the
    // rename and the stored URL is still a twitter.com one.
    const candidates: { network: SocialNetwork; label: string; url: unknown }[] = [
      { network: 'facebook', label: 'Facebook', url: config.facebook },
      { network: 'instagram', label: 'Instagram', url: config.instagram },
      { network: 'x', label: 'X', url: config.twitter },
      { network: 'youtube', label: 'YouTube', url: config.youtube }
    ];
    return candidates
      .filter((c) => typeof c.url === 'string' && c.url.trim().length > 0)
      .map((c) => ({
        network: c.network,
        url: (c.url as string).trim(),
        label: c.label,
        iconUrl: null
      }));
  }

  /**
   * The footer's postal address block, built from config.
   *
   * Deliberately plain markup rather than a styled fragment: renderFooter
   * applies the email's own small-print styling, and anything inline here
   * would fight it.
   */
  async addressHtml(): Promise<string> {
    const config = (await this.webConfig.getAll())[0];
    if (!config) {
      return '';
    }
    const a = config.address;
    const street = [a?.address1, a?.address2].filter((s) => !!s && `${s}`.trim()).join(', ');
    const city = [a?.city, a?.state].filter((s) => !!s && `${s}`.trim()).join(', ');
    const line = [street, [city, a?.zip].filter(Boolean).join(' ').trim()]
      .filter((s) => s && s.length)
      .join('<br>');

    const contact = [
      config.email ? `<a href="mailto:${config.email}">${config.email}</a>` : '',
      config.phone ? this.formatPhone(`${config.phone}`) : ''
    ].filter((s) => s.length).join(' &middot; ');

    return ['<div>Impact Discipleship Ministries</div>',
      line ? `<div>${line}</div>` : '',
      contact ? `<div>${contact}</div>` : ''
    ].filter((s) => s.length).join('');
  }

  /** Stored as ten digits ("6788549322"); shown the way a person reads it. */
  private formatPhone(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    return digits.length === 10
      ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
      : raw;
  }

  /**
   * Where the footer's Unsubscribe link points.
   *
   * Per-environment on purpose: this was once hardcoded to the dev project,
   * so every production unsubscribe flipped the flag in the WRONG database -
   * the recipient saw a success page and kept receiving mail, which is a
   * CAN-SPAM exposure rather than a broken link. The compiled footer emits
   * *|UNSUB|* and the send resolves it per recipient; this is the value the
   * campaign path substitutes.
   */
  unsubscribeUrl(): string {
    return environment.unsubscribeUrl;
  }
}
