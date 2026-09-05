import { Injectable, inject } from '@angular/core';
import { SCREEN_KEYS } from 'src/app/core/main-screen/nav-config';
import { Router } from '@angular/router';
import { EMailTemplatesService } from './data/email-templates.service';
import { MailTemplateModel, MailTemplateKind } from 'src/app/common/models/admin/mail.model';
import { PermissionService } from './permission.service';
import { SnackbarService } from 'src/app/shared/snackbar.service';

/** Where the editor was opened from, so the designer can come back there. */
export interface TemplateEditorReturn {
  /** A key the designer maps to a route - deliberately NOT a URL. A
   *  return-URL parameter would let any link that reaches the designer
   *  redirect it anywhere. */
  // 'summit' is its own key, not a flavour of 'event': Summit and Events are
  // separate screens with separate permission grants, and coming back from a
  // summit's email onto the Events tab loses the record you were editing.
  from: 'event' | 'summit' | 'product' | 'fulfillment' | 'store' | 'campaign';
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
  private readonly router = inject(Router);
  private readonly permissions = inject(PermissionService);
  private readonly snackbar = inject(SnackbarService);

  /** The email builder's own grant. It used to ride System Templates', but
   *  that screen was removed once every template gained a home (2026-08-27)
   *  and the designer needed a permission of its own - it is reachable from
   *  five managers, and a direct URL visit has no calling screen to borrow
   *  from. Stored grants were migrated by
   *  scripts/migrate-email-designer-grant.js. */
  private readonly screenKey = SCREEN_KEYS.tools.emailDesigner;

  canEdit(): boolean {
    return this.permissions.canEdit(this.screenKey);
  }

  /**
   * @param name The template's `name` field - the same string the sender
   *   looks it up by.
   * @param returnTo Where the designer's Back button should return to.
   */
  async openByName(name: string, returnTo?: TemplateEditorReturn): Promise<void> {
    if (!this.canEdit()) {
      return;
    }
    const matches = await this.templates.getAllByValue('name', name);
    this.open(matches[0], `named "${name}"`, returnTo);
  }

  /**
   * Same, for a template addressed by DOC ID - which is how a product's
   * follow-up email is bound (`followUpEmailId`), and how the Cloud Function
   * that sends it resolves it. Addressing it the way the binding does keeps
   * the two from drifting: a product's follow-up survives a rename, an
   * event's registration email does not.
   */
  async openById(id: string, returnTo?: TemplateEditorReturn): Promise<void> {
    if (!this.canEdit()) {
      return;
    }
    const template = await this.templates.getById(id);
    this.open(template ?? undefined, `with id ${id}`, returnTo);
  }

  /**
   * Opens the designer on a NEW template of a given kind, from the screen
   * that will own it.
   *
   * Templates carrying a TEMPLATE_HOME_KINDS kind are hidden from Tools
   * Manager > System Templates - which is where "New Email Design" lives. So
   * for those kinds this is not a shortcut, it is the only way to make one:
   * without it a screen's list can never gain a second entry. The kind rides
   * on the URL so the designer stamps it at save time.
   */
  createNew(kind: MailTemplateKind, returnTo?: TemplateEditorReturn): void {
    if (!this.canEdit()) {
      return;
    }
    void this.router.navigate(['/tools-manager/email-designer', 'new'], {
      queryParams: {
        kind,
        ...(returnTo ? { from: returnTo.from, ...(returnTo.id ? { fromId: returnTo.id } : {}) } : {})
      }
    });
  }

  private open(
    template: MailTemplateModel | undefined,
    describedAs: string,
    returnTo?: TemplateEditorReturn
  ): void {
    if (!template) {
      // Not a silent no-op: a missing template means the process that sends
      // it is currently BROKEN, and saying so here is how anyone finds out.
      // Amazon Shipping Confirmation is missing in production right now for
      // exactly this reason.
      this.snackbar.error(
        `No email template ${describedAs} exists yet, so nothing will be sent. ` +
        'Create one from the screen that sends it.'
      );
      return;
    }

    // ALWAYS the designer, builder template or legacy (2026-08-27).
    //
    // This used to branch: a template with a `design` navigated here, and a
    // legacy one opened EmailTemplateDialogComponent over the calling screen.
    // That dialog never actually worked from here. It is standalone: false
    // and declared in ToolsManagerModule, which is LAZY - so opening it from
    // another feature chunk gives Angular no compilation scope for it unless
    // the admin happened to visit Tools Manager first in the same session.
    // The symptom is a pencil that does nothing at all, reported from an
    // event's Email Template field once Fulfillment and Products had been
    // converted and events were the last screen left on the dialog path.
    //
    // Navigating instead is also just the better answer: the designer imports
    // a legacy template as blocks and converts it on first save, so the same
    // editor serves both and the Quill dialog is left to the one screen that
    // declares it.
    this.router.navigate(['/tools-manager/email-designer', template.id], {
      queryParams: returnTo
        ? { from: returnTo.from, ...(returnTo.id ? { fromId: returnTo.id } : {}) }
        : {}
    });
  }
}
