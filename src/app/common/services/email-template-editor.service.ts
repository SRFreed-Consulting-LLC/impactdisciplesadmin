import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { EMailTemplatesService } from './data/email-templates.service';
import { EmailTemplateDialogComponent } from 'src/app/tools-manager/email-templates/email-template-dialog.component';
import { PermissionService } from './permission.service';
import { SnackbarService } from 'src/app/shared/snackbar.service';

/** Where the editor was opened from, so the designer can come back there.
 *  Only used for BUILDER templates - a legacy rich-text one opens as a
 *  dialog over the current page and never navigates away. */
export interface TemplateEditorReturn {
  /** A key the designer maps to a route - deliberately NOT a URL. A
   *  return-URL parameter would let any link that reaches the designer
   *  redirect it anywhere. */
  from: 'event' | 'product' | 'fulfillment' | 'store' | 'campaign';
  /** The record to deep-link back to, where that screen supports it. */
  id?: string;
}

/**
 * Opens the right editor for one transactional email, from wherever the
 * process that SENDS it lives.
 *
 * Why this exists: every one of these templates is bound to a process -
 * an event's registration confirmation, a product's follow-up, the store's
 * receipt, the fulfillment shipping notice - but the only way to edit one
 * was Tools Manager > System Templates, a screen with no connection to any
 * of them. An admin editing an event had to leave, find the right name in a
 * flat list, and know which of nine it was.
 *
 * The template is addressed BY NAME here, because that is how the senders
 * address it too: the Sales Receipt is looked up by name inside a Cloud
 * Function, and Amazon Shipping Confirmation by name in PurchasesService.
 * Those names are load-bearing - renaming one silently stops the email -
 * which is exactly why the edit surface should be reachable from the
 * process rather than from a list where a rename looks harmless.
 */
@Injectable({ providedIn: 'root' })
export class EmailTemplateEditorService {
  private readonly templates = inject(EMailTemplatesService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly permissions = inject(PermissionService);
  private readonly snackbar = inject(SnackbarService);

  /** Editing any of these rides System Templates' own grant, since that is
   *  the screen they belong to today. Kept as one constant so it moves in
   *  one place when that screen is retired. */
  private readonly screenKey = 'tools-manager.system-templates';

  canEdit(): boolean {
    return this.permissions.canEdit(this.screenKey);
  }

  /**
   * @param name The template's `name` field - the same string the sender
   *   looks it up by.
   * @param returnTo Where to come back to, for builder templates only.
   */
  async openByName(name: string, returnTo?: TemplateEditorReturn): Promise<void> {
    if (!this.canEdit()) {
      return;
    }
    const matches = await this.templates.getAllByValue('name', name);
    const template = matches[0];

    if (!template) {
      // Not a silent no-op: a missing template means the process that sends
      // it is currently BROKEN, and saying so here is how anyone finds out.
      // Amazon Shipping Confirmation is missing in production right now for
      // exactly this reason.
      this.snackbar.error(
        `No email template named "${name}" exists yet, so nothing will be sent. ` +
        'Create it under Tools Manager > System Templates.'
      );
      return;
    }

    if (template.design) {
      // Builder template: full-screen designer, told how to get back.
      this.router.navigate(['/tools-manager/email-designer', template.id], {
        queryParams: returnTo
          ? { from: returnTo.from, ...(returnTo.id ? { fromId: returnTo.id } : {}) }
          : {}
      });
      return;
    }

    // Legacy rich text: a dialog over whatever screen called this, so there
    // is no navigation and nothing to return from. Every transactional
    // template is this kind today.
    this.dialog.open(EmailTemplateDialogComponent, {
      width: '800px',
      data: { item: template }
    });
  }
}
