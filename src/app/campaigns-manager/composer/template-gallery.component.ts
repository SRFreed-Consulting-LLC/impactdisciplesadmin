import { Component, EventEmitter, Output } from '@angular/core';
import { CAMPAIGN_TEMPLATES, CampaignTemplate } from 'src/app/common/models/domain/campaign-template.model';
import { CAMPAIGN_TYPE_LABELS, CampaignType } from 'src/app/common/models/domain/campaign.model';

// The gallery every "+ New Campaign" lands on: pick a recipe (the Composer
// opens pre-filled from it) or start blank. Hosted as an in-page mode by
// Campaigns and Status Board, like the Composer itself.
@Component({
    selector: 'app-template-gallery',
    templateUrl: './template-gallery.component.html',
    styleUrls: ['./template-gallery.component.scss'],
    standalone: false
})
export class TemplateGalleryComponent {
  /** The chosen recipe, or null for "start blank". */
  @Output() picked = new EventEmitter<CampaignTemplate | null>();
  @Output() cancelled = new EventEmitter<void>();

  typeFilter: 'all' | CampaignType = 'all';
  typeLabels = CAMPAIGN_TYPE_LABELS;

  get templates(): CampaignTemplate[] {
    return CAMPAIGN_TEMPLATES.filter((t) => this.typeFilter === 'all' || t.type === this.typeFilter);
  }
}
