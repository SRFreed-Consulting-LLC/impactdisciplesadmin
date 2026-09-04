import { Component, Inject, OnInit, SecurityContext } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { CheckoutForm } from '@impact-common/shared/models/utils/cart.model';
import { EmailDesign, EmailBlock } from 'src/app/common/models/admin/email-design.model';
import { compileEmailDesign } from 'src/app/common/utils/email/email-design-compiler';
import { normalizeInlineHtml } from 'src/app/common/utils/email/inline-html.util';
import { renderMergeTags } from 'src/app/common/utils/email/merge-tags';
import { PurchasesService } from 'src/app/common/services/data/purchases.service';
import { SnackbarService } from '../snackbar.service';

export interface AmazonConfirmationDialogData {
  item: CheckoutForm;
}

/** One block of the template an admin may reword, with a human label. */
export interface EditableBlock {
  /** Index into the flattened body-block list, used to write the edit back. */
  key: string;
  label: string;
  html: string;
}

// The Amazon fulfillment path's final step: show the customer's confirmation
// email, let it be reworded for this order, and send + close in one action.
//
// WHAT CHANGED (2026-09-04). This dialog used to ask for a tracking number and
// nothing else - you pressed send without ever seeing what went out. Two
// problems with that. The obvious one: no way to say anything specific about a
// particular order. The other only turned up on inspection - the template holds
// exactly ONE merge tag, *|FNAME|*, and no *|TRACKING|* at all, so every
// tracking number typed into that prompt went into a context nothing read and
// reached no customer. The field is gone rather than fixed; a tracking number
// now goes in the message like any other words.
//
// WHY FIELDS AND NOT A RICH TEXT BOX. The template is email-builder authored:
// its stored html is compiled tables with Outlook conditionals and a <style>
// block, and putting that through an editor would mangle the layout. So the
// EDIT surface is the design's own text blocks - one editable region each -
// and the html is RECOMPILED from the design on send. The layout is therefore
// untouchable by construction, while every word in it can be changed.
//
// PER SEND ONLY. The stored template is never written. An order-specific note
// must not leak into every future customer's email; changing the template for
// good is still the pencil button on the fulfillment screen, which opens the
// real designer.
@Component({
    selector: 'app-amazon-confirmation-dialog',
    templateUrl: './amazon-confirmation-dialog.component.html',
    styleUrls: ['./amazon-confirmation-dialog.component.scss'],
    standalone: false
})
export class AmazonConfirmationDialogComponent implements OnInit {
  loading = true;
  sending = false;
  loadError = '';

  subject = '';
  blocks: EditableBlock[] = [];

  private design: EmailDesign | null = null;
  /** Legacy templates carry no design; their html is sent as authored. */
  private fallbackHtml = '';

  // The preview is memoized because a getter that re-sanitizes every change
  // detection cycle makes the iframe reload in a loop - the same trap the
  // email designer's own preview documents.
  private previewCache = '';
  private previewSafe: SafeHtml | null = null;

  constructor(
    private dialogRef: MatDialogRef<AmazonConfirmationDialogComponent, CheckoutForm | null>,
    @Inject(MAT_DIALOG_DATA) public data: AmazonConfirmationDialogData,
    private service: PurchasesService,
    private snackbar: SnackbarService,
    private sanitizer: DomSanitizer
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      const template = await this.service.loadAmazonConfirmationTemplate();
      this.subject = template.subject || 'Your order is on its way!';
      this.design = (template.design as EmailDesign) ?? null;
      this.fallbackHtml = template.html ?? '';
      this.blocks = this.design ? collectEditableBlocks(this.design) : [];
    } catch (err) {
      // Refusing to send beats sending something we could not read: the
      // customer's only notification should never be assembled from a
      // half-loaded template.
      this.loadError = (err as Error)?.message ?? 'The email template could not be loaded.';
    } finally {
      this.loading = false;
    }
  }

  get recipient(): string {
    return (this.data.item.email ?? '').trim();
  }

  /** True once there is something sendable. */
  get canSend(): boolean {
    return !this.loading && !this.loadError && !!this.subject.trim() && !this.sending;
  }

  /**
   * Captures an edit from a contenteditable region.
   * @param block The block being edited.
   * @param html Its current innerHTML.
   */
  onBlockEdited(block: EditableBlock, html: string): void {
    // Sanitized on the way IN, so nothing unsafe can reach the compiler or the
    // preview - the same normalizer the designer's inline editor uses.
    block.html = normalizeInlineHtml(html);
  }

  /** The email exactly as the customer will receive it. */
  get preview(): SafeHtml {
    const html = this.renderedHtml();
    if (html !== this.previewCache || !this.previewSafe) {
      this.previewCache = html;
      // bypassSecurityTrust is wrong here: the iframe is sandboxed with no
      // scripts, and sanitizing keeps the preview honest about what Angular
      // would allow. The compiled email is plain tables either way.
      this.previewSafe = this.sanitizer.sanitize(SecurityContext.HTML, html) ?? '';
    }
    return this.previewSafe;
  }

  /** Compiles the edited design and resolves merge tags for this purchase. */
  private renderedHtml(): string {
    const context = this.service.amazonConfirmationContext(this.data.item);
    const source = this.design ?
      compileEmailDesign(applyEdits(this.design, this.blocks)) :
      this.fallbackHtml;
    return renderMergeTags(source, context);
  }

  async send(): Promise<void> {
    if (!this.canSend) {
      return;
    }
    this.sending = true;
    try {
      const context = this.service.amazonConfirmationContext(this.data.item);
      const saved = await this.service.sendAmazonConfirmation(this.data.item, {
        subject: renderMergeTags(this.subject, context),
        html: this.renderedHtml()
      });
      this.snackbar.success('Confirmation email sent - order closed');
      this.dialogRef.close(saved);
    } catch (err) {
      this.snackbar.error((err as Error)?.message ?? 'Sending the confirmation failed - please try again.');
    } finally {
      this.sending = false;
    }
  }

  onCancel(): void {
    this.dialogRef.close(null);
  }
}

/** Block types whose props.html is prose an admin may reword. */
const EDITABLE_TYPES = ['heading', 'text', 'html'];

/**
 * The reworded-able blocks of a design, in reading order.
 *
 * Body only. The header and footer are chrome - a logo, an address, an
 * unsubscribe line - and offering them per order invites someone to edit the
 * ministry's address on one customer's email and nowhere else.
 * @param design The template's design.
 * @returns Editable blocks with stable keys.
 */
export function collectEditableBlocks(design: EmailDesign): EditableBlock[] {
  const out: EditableBlock[] = [];
  (design.sections ?? []).forEach((section, si) => {
    if (section.kind !== 'body') {
      return;
    }
    (section.rows ?? []).forEach((row, ri) => {
      (row.columns ?? []).forEach((col, ci) => {
        (col.blocks ?? []).forEach((block: EmailBlock, bi) => {
          if (!EDITABLE_TYPES.includes(block.type)) {
            return;
          }
          const html = (block as { props?: { html?: string } }).props?.html ?? '';
          out.push({
            key: `${si}.${ri}.${ci}.${bi}`,
            label: block.type === 'heading' ? 'Heading' : `Paragraph ${out.length}`,
            html
          });
        });
      });
    });
  });
  // Labels read better numbered from 1 once the heading is accounted for.
  let n = 0;
  for (const b of out) {
    if (b.label !== 'Heading') {
      b.label = `Paragraph ${++n}`;
    }
  }
  return out;
}

/**
 * A copy of the design with the edited block html written back.
 *
 * A deep clone, never a mutation: the loaded template object is the only copy
 * of what is stored, and editing it in place would make "per send only" a lie
 * the moment anything else re-read it.
 * @param design The template's design.
 * @param blocks The edited blocks.
 * @returns A new design carrying the edits.
 */
export function applyEdits(design: EmailDesign, blocks: EditableBlock[]): EmailDesign {
  const clone = JSON.parse(JSON.stringify(design)) as EmailDesign;
  for (const edited of blocks) {
    const [si, ri, ci, bi] = edited.key.split('.').map(Number);
    const block = clone.sections?.[si]?.rows?.[ri]?.columns?.[ci]?.blocks?.[bi] as
      { props?: { html?: string } } | undefined;
    if (block?.props) {
      block.props.html = edited.html;
    }
  }
  return clone;
}
