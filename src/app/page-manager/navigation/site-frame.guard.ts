import { libraryUnsavedChangesGuard } from 'src/app/common/guards/library-unsaved-changes.guard';
import type { NavigationComponent } from './navigation.component';
import type { SiteFooterAdminComponent } from '../footer/footer.component';

/**
 * "You have unsaved changes" for the two screens that edit the SITE'S FRAME -
 * its top menu and its footer.
 *
 * WHY THIS EXISTS (2026-08-30). Shane switched a footer link off, went to
 * look at the public site, came back, refreshed, and found it switched back
 * on - and reasonably read that as the save being broken. It was not: both
 * screens hold a local working copy and publish it on SAVE, which is
 * deliberate, because a menu is a shape and saving each individual drag would
 * push half-finished arrangements onto a live site.
 *
 * The defect was that NOTHING SAID SO on the way out. The header showed
 * "Unsaved changes" and the browser let him leave anyway, so the only
 * evidence that work had been lost arrived after it was gone. A screen whose
 * edits are deliberately not auto-saved has to defend the exit.
 *
 * Reuses the guard the Library editors already use rather than growing a
 * second one - it offers Save / Discard / Cancel, and on a failed save it
 * STAYS PUT rather than navigating away with the changes silently gone.
 */
export const navigationCanDeactivateGuard =
  libraryUnsavedChangesGuard<NavigationComponent>(
    'menu',
    'The menu could not be saved, so you are still on this page.',
  );

export const footerCanDeactivateGuard =
  libraryUnsavedChangesGuard<SiteFooterAdminComponent>(
    'footer',
    'The footer could not be saved, so you are still on this page.',
  );
