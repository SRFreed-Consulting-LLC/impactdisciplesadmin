import {
  EmailRow,
  LogoBlock,
  createBlock,
  createRow
} from 'src/app/common/models/admin/email-design.model';
import { ARCHIVE_SHELLS } from './archive-shells';

/**
 * Ready-made header and footer rows, draggable onto ANY design.
 *
 * Why these are separate from STARTER_TEMPLATES: a starter is a whole email,
 * offered only when creating a NEW template, and applying one replaces
 * everything. That left no way at all to put a masthead on an email that
 * already exists - the Amazon shipping confirmation had an empty header
 * section and no route to filling it short of a data script.
 *
 * A piece is ONE ROW, so it drops into a section's row list exactly the way a
 * layout preset does (handleRowDrop), and lands wherever it is dropped rather
 * than replacing anything.
 *
 * TWO FAMILIES, and the difference matters when picking one:
 *
 *   'newsletter' - chrome mined from the real Mailchimp archive. Masthead,
 *      social row, address. Right for campaigns; heavy for a receipt.
 *   'transactional' - the plain convention the receipt/registration emails
 *      already use (see scripts/convert-template-to-builder.js, whose block
 *      specs these are lifted from). Right for anything a purchase or a
 *      registration triggers.
 *
 * Neither family is BLOCKED anywhere. Once the Mailchimp system tags were
 * cleaned out (scripts/lib/email-chrome-clean.js) there is nothing unsafe
 * about a newsletter footer on a transactional email - just heavy - and a
 * rule that guesses wrong is worse than a label that informs.
 */
export type ChromeKind = 'header' | 'footer';
export type ChromeFamily = 'newsletter' | 'transactional';

export interface ChromePiece {
  id: string;
  name: string;
  description: string;
  kind: ChromeKind;
  family: ChromeFamily;
  /** A fresh row every call - two drags of one chip must not share blocks. */
  build: () => EmailRow;
}

/** Wraps mined markup in a one-column row holding a single html block.
 *
 *  Raw html rather than reconstructed image/social/footer blocks, for the
 *  same reason buildArchiveShell always did it this way: Mailchimp chrome is
 *  deeply nested tables carrying their own inline styles, and taking it apart
 *  would change how it renders - the entire reason to reuse it is that it is
 *  known to survive real inboxes. */
function htmlRow(html: string): EmailRow {
  const row = createRow(1);
  const block = createBlock('html');
  if (block.type === 'html') {
    block.props.html = html;
  }
  row.columns[0].blocks = [block];
  return row;
}

// The masthead the Sales Receipt uses. The bucket is the PRODUCTION one on
// purpose - same as DEFAULT_SOCIAL_ICON_URLS - because an email is read long
// after it is sent and from outside any of our environments, so a dev-bucket
// URL would be a broken image in a real inbox.
const RECEIPT_LOGO_URL =
  'https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8.appspot.com/o/' +
  'Logos%2FImpact-Logo_Black.png?alt=media&token=2a2452b7-a337-476f-b268-d0a4b0fa5d42';

function receiptMastheadRow(): EmailRow {
  const row = createRow(1);
  const block = createBlock('logo') as LogoBlock;
  block.props.src = RECEIPT_LOGO_URL;
  block.props.alt = 'Impact Discipleship Ministries';
  block.props.sizing = 'original';
  block.props.naturalWidth = 200;
  block.styles.align = 'center';
  row.columns[0].blocks = [block];
  return row;
}

function signOffRow(): EmailRow {
  const row = createRow(1);
  const block = createBlock('text');
  if (block.type === 'text') {
    block.props.html = '<p>Blessings,</p><p><strong>The Impact Ministries Team</strong></p>';
  }
  block.styles.align = 'left';
  row.columns[0].blocks = [block];
  return row;
}

// A real logo/text block rather than raw html: unlike the mined chrome these
// are simple enough to rebuild faithfully, and as real blocks they get the
// image picker, the inline editor and the style panel.
const TRANSACTIONAL_PIECES: ChromePiece[] = [
  {
    id: 'chrome-receipt-masthead',
    name: 'Logo masthead',
    description: 'Centred logo, as on the Sales Receipt.',
    kind: 'header',
    family: 'transactional',
    build: receiptMastheadRow
  },
  {
    id: 'chrome-signoff',
    name: 'Sign-off',
    description: '"Blessings, The Impact Ministries Team" - the receipt sign-off.',
    kind: 'footer',
    family: 'transactional',
    build: signOffRow
  }
];

/**
 * The mined shells, SPLIT.
 *
 * ARCHIVE_SHELLS stores `header` and `footer` as separate fields already and
 * only buildArchiveShell ever welded them together, so this costs nothing.
 * They stay in shell order, and each keeps its shell's usage description, so
 * a matching pair is still findable by eye ("Newsletter 1" header with
 * "Newsletter 1" footer).
 */
const ARCHIVE_PIECES: ChromePiece[] = ARCHIVE_SHELLS.flatMap((shell, index) => {
  const label = `Newsletter ${index + 1}`;
  return [
    {
      id: `${shell.id}-header`,
      name: `${label} header`,
      description: shell.description,
      kind: 'header' as const,
      family: 'newsletter' as const,
      build: () => htmlRow(shell.header)
    },
    {
      id: `${shell.id}-footer`,
      name: `${label} footer`,
      description: shell.description,
      kind: 'footer' as const,
      family: 'newsletter' as const,
      build: () => htmlRow(shell.footer)
    }
  ];
});

// Transactional first: they are the short, plain ones, and the palette is
// read top-down by someone who most often wants a masthead.
export const CHROME_PIECES: ChromePiece[] = [...TRANSACTIONAL_PIECES, ...ARCHIVE_PIECES];

/** Looks a piece up by id - the palette drags an id, not an object. */
export function chromePieceById(id: string): ChromePiece | undefined {
  return CHROME_PIECES.find((piece) => piece.id === id);
}
