import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { CheckoutForm } from '@impact-common/shared/models/utils/cart.model';
import { EmailDesign } from 'src/app/common/models/admin/email-design.model';
import { compileEmailDesign } from 'src/app/common/utils/email/email-design-compiler';
import { normalizeInlineHtml } from 'src/app/common/utils/email/inline-html.util';
import { renderMergeTags } from 'src/app/common/utils/email/merge-tags';
import { PurchasesService } from 'src/app/common/services/data/purchases.service';
import { RICH_TEXT_TOOLBAR } from '../rich-text-editor/quill-toolbar.config';
import { SnackbarService } from '../snackbar.service';

export interface AmazonConfirmationDialogData {
  item: CheckoutForm;
}

// The Amazon path's final step: write the customer's confirmation, send it, and
// close the order.
//
// WHAT THIS DIALOG IS FOR. It used to ask for a tracking number and nothing
// else - you pressed send without ever seeing what went out, and could not say
// anything specific about a particular order. (The tracking prompt was also
// doing nothing: the template holds one merge tag, *|FNAME|*, and no
// *|TRACKING|* at all, so every number typed there reached no customer. A
// tracking number now goes in the message like any other words.)
//
// WHAT YOU EDIT IS THE BODY. The template is email-builder authored - its
// stored html is compiled tables with Outlook conditionals - so the editor
// never touches that. It edits the words in the body SECTION, and the html is
// RECOMPILED from the design on send. The logo header and the footer are
// untouched by construction, and no amount of typing can break the layout.
//
// PER SEND ONLY. The stored template is never written. An order-specific note
// must not leak into every future customer's email.
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
  /** The body copy, as Quill edits it. */
  message = '';

  readonly richTextModules = RICH_TEXT_TOOLBAR;

  private design: EmailDesign | null = null;
  /** Legacy templates carry no design; their html is sent as authored. */
  private fallbackHtml = '';

  constructor(
    private dialogRef: MatDialogRef<AmazonConfirmationDialogComponent, CheckoutForm | null>,
    @Inject(MAT_DIALOG_DATA) public data: AmazonConfirmationDialogData,
    private service: PurchasesService,
    private snackbar: SnackbarService
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      const template = await this.service.loadAmazonConfirmationTemplate();
      this.subject = template.subject || 'Your order is on its way!';
      this.design = (template.design as EmailDesign) ?? null;
      this.fallbackHtml = template.html ?? '';
      // Pre-filled with the standard wording, so the common case is: read it,
      // add a line, send. Starting blank would mean retyping the same message
      // on every routine order.
      this.message = this.design ? bodyHtmlOf(this.design) : '';
    } catch (err) {
      // Refusing to send beats sending something we could not read: the
      // customer's only notification should never be assembled from a
      // half-loaded template.
      this.loadError = (err as Error)?.message ?? 'The email template could not be loaded.';
    } finally {
      this.loading = false;
    }
  }

  get recipientName(): string {
    return [this.data.item.firstName, this.data.item.lastName]
      .filter(Boolean).join(' ').trim() || 'this contact';
  }

  get recipientEmail(): string {
    return (this.data.item.email ?? '').trim();
  }

  get orderRef(): string {
    return this.data.item.receipt || this.data.item.id || '';
  }

  get canSend(): boolean {
    return !this.loading && !this.loadError && !this.sending
      && !!this.subject.trim() && !!plainTextOf(this.message).trim();
  }

  async send(): Promise<void> {
    if (!this.canSend) {
      return;
    }
    this.sending = true;
    try {
      const context = this.service.amazonConfirmationContext(this.data.item);
      const body = normalizeInlineHtml(this.message);
      const source = this.design ?
        compileEmailDesign(withBodyHtml(this.design, body)) :
        this.fallbackHtml;

      const saved = await this.service.sendAmazonConfirmation(this.data.item, {
        subject: renderMergeTags(this.subject, context),
        html: renderMergeTags(source, context)
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

interface ProseBlock { type: string; props?: { html?: string } }

/** Is this block one of the body's words? */
function isProse(block: ProseBlock): boolean {
  return EDITABLE_TYPES.includes(block.type);
}

/**
 * The body's words, as one document for the editor.
 *
 * BODY SECTION ONLY. The header is a logo and the footer carries the ministry's
 * address and opt-out line - offering those per order invites changing the
 * address on one customer's email and nowhere else.
 * @param design The template's design.
 * @returns The joined html of every prose block in the body.
 */
export function bodyHtmlOf(design: EmailDesign): string {
  const parts: string[] = [];
  for (const section of design.sections ?? []) {
    if ((section as { kind?: string }).kind !== 'body') {
      continue;
    }
    for (const row of (section as { rows?: unknown[] }).rows ?? []) {
      for (const col of (row as { columns?: unknown[] }).columns ?? []) {
        for (const block of (col as { blocks?: ProseBlock[] }).blocks ?? []) {
          if (isProse(block) && block.props?.html) {
            parts.push(block.props.html);
          }
        }
      }
    }
  }
  return parts.join('\n');
}

/**
 * A copy of the design whose body carries `html` and nothing else of its own.
 *
 * The edited words become ONE block, because that is what the editor is: one
 * document. The carrier is the body's first TEXT block where there is one, so
 * the copy keeps the styling it was designed with rather than inheriting a
 * heading's size; it sits where the first prose block sat, so anything around
 * it - a divider, a picture - keeps its place. Every other prose block goes,
 * since its words are already in `html`.
 *
 * A deep clone, never a mutation: the loaded template is the only copy of what
 * is stored, and editing it in place would make "per send only" a lie the
 * moment anything else re-read it.
 * @param design The template's design.
 * @param html The edited body copy.
 * @returns A new design carrying the edit.
 */
export function withBodyHtml(design: EmailDesign, html: string): EmailDesign {
  const clone = JSON.parse(JSON.stringify(design)) as EmailDesign;
  for (const section of clone.sections ?? []) {
    if ((section as { kind?: string }).kind !== 'body') {
      continue;
    }
    for (const row of (section as { rows?: unknown[] }).rows ?? []) {
      for (const col of (row as { columns?: unknown[] }).columns ?? []) {
        const holder = col as { blocks?: ProseBlock[] };
        const blocks = holder.blocks ?? [];
        const first = blocks.findIndex(isProse);
        if (first < 0) {
          continue;
        }
        const prose = blocks.filter(isProse);
        // Prefer a text block's styling; a heading's would set body copy at
        // heading size.
        const carrier = prose.find((b) => b.type === 'text') ?? prose[0];
        const kept: ProseBlock[] = [];
        blocks.forEach((block, i) => {
          if (!isProse(block)) {
            kept.push(block);
            return;
          }
          if (i === first) {
            kept.push({
              ...carrier,
              type: 'text',
              props: { ...(carrier.props ?? {}), html }
            });
          }
        });
        holder.blocks = kept;
        // Only the first column that holds prose becomes the message; a second
        // one would repeat it.
        return clone;
      }
    }
  }
  return clone;
}

/** Quill gives back html; this is only for "did they type anything". */
function plainTextOf(html: string): string {
  return (html ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}
