import { CanDeactivateFn } from '@angular/router';
import { EmailDesignerComponent } from './email-designer.component';

// Dirty-guard for the full-screen designer - prompts (via the component's
// own ConfirmService flow) before navigating away from unsaved changes.
// Functional guard, matching the repo's authGuard style.
export const emailDesignerCanDeactivateGuard: CanDeactivateFn<EmailDesignerComponent> = (component) => {
  return component.canLeave();
};
