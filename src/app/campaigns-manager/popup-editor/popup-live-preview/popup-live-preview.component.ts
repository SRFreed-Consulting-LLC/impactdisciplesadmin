import { Component, EventEmitter, Input, Output } from '@angular/core';
import { SafeHtml } from '@angular/platform-browser';
import { PopupCta, PopupCtaField } from 'src/app/common/models/domain/campaign-popup.model';

/** Everything the renderer needs, built by the editor from its live form. */
export interface PopupPreviewData {
  html: SafeHtml | null;
  width: number;
  height: number;
  bgColor: string;
  cta: PopupCta;
}

// A faithful copy of the WEB repo's campaign-popup component - same class
// names, same DOM, same styling - so the admin can show an author exactly
// what a site visitor sees rather than an approximation of it.
//
// Two modes:
//   - 'inline'  : embedded in the editor's side panel (the overlay flattens).
//   - 'overlay' : the LAUNCH POPUP button - a real fixed, full-screen popup.
//
// Every action is INERT: nothing navigates, nothing is submitted, no beacon
// is fired. The form CTA flashes the real "Thank you" state so that half of
// the design is previewable too.
//
// MIRROR any change here into the web repo's campaign-popup component
// (html + scss) - the two are independent copies, hand-synced, exactly like
// CampaignPopupModel and its CampaignPopup twin.
@Component({
  selector: 'app-popup-live-preview',
  templateUrl: './popup-live-preview.component.html',
  styleUrls: ['./popup-live-preview.component.scss'],
  standalone: false
})
export class PopupLivePreviewComponent {
  @Input() popup!: PopupPreviewData;
  @Input() mode: 'inline' | 'overlay' = 'inline';
  @Output() closed = new EventEmitter<void>();

  submitDone = false;

  ctaFields(): PopupCtaField[] {
    return this.popup?.cta?.formFields ?? ['email'];
  }

  fieldLabel(field: PopupCtaField): string {
    return { email: 'Email', firstName: 'First name', lastName: 'Last name', phone: 'Phone' }[field];
  }

  // Form CTA: flash the storefront's real success state, then revert so the
  // author can trigger it again. Link/close: dismiss (overlay) or no-op.
  onPrimary(): void {
    if (this.popup?.cta?.type === 'form') {
      this.submitDone = true;
      setTimeout(() => this.submitDone = false, 1800);
      return;
    }
    this.dismiss();
  }

  // Inline mode has nowhere to dismiss TO - blanking the side panel would
  // just lose the preview, so only the launched overlay closes.
  dismiss(): void {
    if (this.mode === 'overlay') {
      this.closed.emit();
    }
  }
}
