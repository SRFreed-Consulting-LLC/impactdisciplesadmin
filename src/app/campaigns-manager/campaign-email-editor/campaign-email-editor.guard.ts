import { CanDeactivateFn } from '@angular/router';
import { CampaignEmailEditorComponent } from './campaign-email-editor.component';

// Dirty-guard for the campaign email editor - prompts (via the component's
// own ConfirmService flow) before navigating away from an unsaved design or
// unsaved send settings. Functional guard, matching emailDesignerCanDeactivateGuard.
export const campaignEmailEditorCanDeactivateGuard: CanDeactivateFn<CampaignEmailEditorComponent> = (component) => {
  return component.canLeave();
};
