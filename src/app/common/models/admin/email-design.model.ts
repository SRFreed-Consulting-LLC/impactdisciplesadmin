// The email designer's persisted document shape. A builder-authored template
// stores one of these under MailTemplateModel.design (presence of `design`
// is what marks a template as "Email Builder" rather than legacy Quill), and
// the compiled, sendable HTML is always re-derived from it at save time by
// email-design-compiler.ts - downstream consumers only ever read `html`.
//
// Firestore rule: use `null` for "unset", NEVER `undefined` - the DAO
// setDoc()s whole documents and Firestore rejects any nested undefined (see
// CLAUDE.md's write gotcha and utils/strip-undefined.ts).

export const EMAIL_DESIGN_VERSION = 1;

export type SectionKind = 'header' | 'body' | 'footer';

export type BlockType =
  | 'heading'
  | 'text'
  | 'image'
  | 'logo'
  | 'button'
  | 'divider'
  | 'spacer'
  | 'video'
  | 'social'
  | 'footer'
  | 'html';

export type BorderStyle =
  | 'solid'
  | 'dashed'
  | 'dotted'
  | 'double'
  | 'inset'
  | 'outset'
  | 'groove'
  | 'ridge';

export type BlockAlign = 'left' | 'center' | 'right';

export interface BoxSides {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface BoxCorners {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

export interface BlockBorder {
  width: number;
  style: BorderStyle;
  color: string;
}

// The per-block/per-row style kit - mirrors Mailchimp's block Style panel.
export interface BlockStyles {
  padding: BoxSides;
  // Spacing OUTSIDE the background/border (P1 gap-closure, 2026-08-18) -
  // compiled as transparent padding on an outer wrapper cell, since email
  // clients don't do real margins reliably. Optional for back-compat with
  // designs saved before it existed; normalizeDesign() backfills zeros.
  margin?: BoxSides;
  border: BlockBorder | null; // null = no border
  borderRadius: BoxCorners;
  backgroundColor: string | null; // null = transparent / inherit section
  align: BlockAlign;
}

export const ZERO_SIDES: BoxSides = { top: 0, right: 0, bottom: 0, left: 0 };

// Shared font menu - the email-wide Styles panel and the per-block font
// override both offer exactly these email-safe stacks.
export const EMAIL_FONT_FAMILIES: readonly string[] = [
  'Helvetica, Arial, sans-serif',
  'Arial, Helvetica, sans-serif',
  'Georgia, Times New Roman, serif',
  'Times New Roman, Georgia, serif',
  'Verdana, Geneva, sans-serif',
  'Tahoma, Geneva, sans-serif',
  'Trebuchet MS, Helvetica, sans-serif',
  'Courier New, Courier, monospace'
];

// Email-wide defaults, one set per device. Mailchimp's Styles tab.
export interface GlobalStyleSet {
  emailBackgroundColor: string; // the canvas outside the 600px page
  bodyBackgroundColor: string; // the page itself
  heading: {
    fontFamily: string;
    color: string;
    sizes: { h1: number; h2: number; h3: number; h4: number };
  };
  paragraph: { fontFamily: string; fontSize: number; color: string; lineHeight: number };
  link: { color: string; underline: boolean };
  button: {
    backgroundColor: string;
    color: string;
    borderRadius: number;
    fontSize: number;
    padding: BoxSides;
  };
  divider: { style: BorderStyle; color: string; thickness: number };
}

// ---------------------------------------------------------------- blocks

export interface EmailBlockBase {
  id: string;
  type: BlockType;
  styles: BlockStyles; // desktop
  // Sparse phone-only overrides; only consulted when stylesLinked === false
  // (Mailchimp's "unlink desktop and mobile styles"). {} while linked.
  mobileStyles: Partial<BlockStyles>;
  stylesLinked: boolean;
  // Visibility (P1 gap-closure): `hidden` grays the block on the canvas
  // and excludes it from the compiled email entirely (Mailchimp's
  // slashed-eye); hideOnMobile/hideOnDesktop exclude it per device via
  // the compiled @media rules. Optional for back-compat; normalizeDesign()
  // backfills false.
  hidden?: boolean;
  hideOnMobile?: boolean;
  hideOnDesktop?: boolean;
}

export interface HeadingBlock extends EmailBlockBase {
  type: 'heading';
  // fontFamily null = the email-wide heading default (P1: per-block font).
  props: { html: string; level: 1 | 2 | 3 | 4; fontFamily?: string | null };
}

export interface TextBlock extends EmailBlockBase {
  type: 'text';
  // fontFamily null = the email-wide paragraph default.
  props: { html: string; fontFamily?: string | null };
}

// Raw-markup escape hatch (P1) - sanitized (scripts stripped) at edit time,
// passed through by the compiler otherwise untouched.
export interface HtmlBlock extends EmailBlockBase {
  type: 'html';
  props: { html: string };
}

export interface ImageProps {
  src: string | null; // Storage download URL; null = placeholder
  alt: string;
  href: string | null;
  openInNewTab: boolean;
  sizing: 'original' | 'fill' | 'scale';
  scalePercent: number; // 10-100, only meaningful when sizing === 'scale'
  // Natural pixel width when known (captured at pick time); lets the
  // compiler cap 'original' images at their true size.
  naturalWidth: number | null;
}

export interface ImageBlock extends EmailBlockBase {
  type: 'image';
  props: ImageProps;
}

// Same shape as Image - a Logo is just an image block that palettes/starters
// treat as the brand mark (Mailchimp models it the same way).
export interface LogoBlock extends EmailBlockBase {
  type: 'logo';
  props: ImageProps;
}

export interface ButtonBlock extends EmailBlockBase {
  type: 'button';
  props: {
    label: string;
    href: string;
    fullWidth: boolean;
    // null = inherit the corresponding globalStyles.button default
    backgroundColor: string | null;
    color: string | null;
    borderRadius: number | null;
    fontSize: number | null;
  };
}

export interface DividerBlock extends EmailBlockBase {
  type: 'divider';
  // null = inherit globalStyles.divider
  props: { style: BorderStyle | null; thickness: number | null; color: string | null };
}

export interface SpacerBlock extends EmailBlockBase {
  type: 'spacer';
  props: { height: number };
}

export type VideoProvider = 'youtube' | 'vimeo' | 'other';

export interface VideoBlock extends EmailBlockBase {
  type: 'video';
  props: {
    url: string;
    provider: VideoProvider;
    videoId: string | null;
    thumbnailUrl: string | null; // auto-fetched or manually chosen
    customThumbnail: boolean; // true = user replaced the source thumbnail
    caption: string; // alt text / accessible label for the thumbnail link
  };
}

export type SocialNetwork =
  | 'facebook'
  | 'instagram'
  | 'x'
  | 'youtube'
  | 'linkedin'
  | 'tiktok'
  | 'custom';

export interface SocialNetworkLink {
  network: SocialNetwork;
  url: string;
  label: string;
  // Hosted icon image URL (uploaded once to Storage under
  // email-assets/social/). null = the compiler falls back to a text link.
  iconUrl: string | null;
}

export interface SocialBlock extends EmailBlockBase {
  type: 'social';
  props: { networks: SocialNetworkLink[]; iconSize: number; spacing: number };
}

export interface FooterBlock extends EmailBlockBase {
  type: 'footer';
  props: {
    addressHtml: string;
    permissionReminder: string;
    includeUnsubscribe: boolean;
    unsubscribeLabel: string;
  };
}

export type EmailBlock =
  | HeadingBlock
  | TextBlock
  | ImageBlock
  | LogoBlock
  | ButtonBlock
  | DividerBlock
  | SpacerBlock
  | VideoBlock
  | SocialBlock
  | FooterBlock
  | HtmlBlock;

// ---------------------------------------------------------------- layout

export interface EmailColumn {
  id: string;
  widthPercent: number; // per-row widths sum to 100
  blocks: EmailBlock[];
}

export interface EmailRow {
  id: string;
  columns: EmailColumn[]; // 1-4
  styles: BlockStyles;
  mobileStyles: Partial<BlockStyles>;
  stylesLinked: boolean;
}

export interface EmailSection {
  id: string;
  kind: SectionKind;
  // Display name (P1 section management: sections are addable/renamable/
  // duplicatable now, so "Body" alone stops being descriptive). null =
  // fall back to the kind label.
  name?: string | null;
  backgroundColor: string | null; // null = body background
  rows: EmailRow[];
}

export interface EmailDesign {
  version: number;
  contentWidth: number; // 600
  // The inbox snippet shown next to the subject (P1) - compiled as a
  // hidden preheader div at the top of the email body. Null/empty = none.
  preheader?: string | null;
  globalStyles: { desktop: GlobalStyleSet; mobile: Partial<GlobalStyleSet> };
  // Starts as [header, body, footer]; sections are addable/removable/
  // reorderable since P1 (new ones get kind 'body').
  sections: EmailSection[];
}

// ---------------------------------------------------------------- factories

export function newDesignId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function createDefaultBlockStyles(): BlockStyles {
  return {
    padding: { top: 8, right: 24, bottom: 8, left: 24 },
    margin: { ...ZERO_SIDES },
    border: null,
    borderRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
    backgroundColor: null,
    align: 'center'
  };
}

// Backfills fields added after a design was saved (margin, visibility
// flags, section names, preheader) so the editor and compiler never meet
// undefined structure. Run on every load; mutates and returns the design.
export function normalizeDesign(design: EmailDesign): EmailDesign {
  design.preheader = design.preheader ?? null;
  for (const section of design.sections ?? []) {
    section.name = section.name ?? null;
    for (const row of section.rows ?? []) {
      row.styles.margin = row.styles.margin ?? { ...ZERO_SIDES };
      for (const column of row.columns ?? []) {
        for (const block of column.blocks ?? []) {
          block.styles.margin = block.styles.margin ?? { ...ZERO_SIDES };
          block.hidden = block.hidden ?? false;
          block.hideOnMobile = block.hideOnMobile ?? false;
          block.hideOnDesktop = block.hideOnDesktop ?? false;
        }
      }
    }
  }
  return design;
}

export function createDefaultGlobalStyles(): GlobalStyleSet {
  return {
    emailBackgroundColor: '#e9ecef',
    bodyBackgroundColor: '#ffffff',
    heading: {
      fontFamily: 'Georgia, Times New Roman, serif',
      color: '#1f2430',
      sizes: { h1: 28, h2: 22, h3: 18, h4: 16 }
    },
    paragraph: {
      fontFamily: 'Helvetica, Arial, sans-serif',
      fontSize: 14,
      color: '#454d58',
      lineHeight: 1.6
    },
    link: { color: '#0b5a5a', underline: true },
    button: {
      backgroundColor: '#1f3a5f',
      color: '#ffffff',
      borderRadius: 6,
      fontSize: 14,
      padding: { top: 12, right: 30, bottom: 12, left: 30 }
    },
    divider: { style: 'solid', color: '#dfe3e8', thickness: 1 }
  };
}

const DEFAULT_IMAGE_PROPS: ImageProps = {
  src: null,
  alt: '',
  href: null,
  openInNewTab: true,
  sizing: 'fill',
  scalePercent: 100,
  naturalWidth: null
};

export function createBlock(type: BlockType): EmailBlock {
  const base: EmailBlockBase = {
    id: newDesignId(),
    type,
    styles: createDefaultBlockStyles(),
    mobileStyles: {},
    stylesLinked: true,
    hidden: false,
    hideOnMobile: false,
    hideOnDesktop: false
  };
  switch (type) {
    case 'heading':
      return { ...base, type, props: { html: 'Add a heading', level: 2, fontFamily: null } };
    case 'text':
      return { ...base, type, props: { html: '<p>Add your text here.</p>', fontFamily: null } };
    case 'html':
      return { ...base, type, props: { html: '<!-- Paste your HTML here -->' } };
    case 'image':
      return { ...base, type, props: { ...DEFAULT_IMAGE_PROPS } };
    case 'logo':
      return { ...base, type, props: { ...DEFAULT_IMAGE_PROPS, sizing: 'original' } };
    case 'button':
      return {
        ...base,
        type,
        props: {
          label: 'Click here',
          href: '',
          fullWidth: false,
          backgroundColor: null,
          color: null,
          borderRadius: null,
          fontSize: null
        }
      };
    case 'divider':
      return { ...base, type, props: { style: null, thickness: null, color: null } };
    case 'spacer':
      return { ...base, type, props: { height: 24 } };
    case 'video':
      return {
        ...base,
        type,
        props: {
          url: '',
          provider: 'other',
          videoId: null,
          thumbnailUrl: null,
          customThumbnail: false,
          caption: 'Watch video'
        }
      };
    case 'social':
      return {
        ...base,
        type,
        props: {
          networks: [
            { network: 'facebook', url: '', label: 'Facebook', iconUrl: null },
            { network: 'instagram', url: '', label: 'Instagram', iconUrl: null },
            { network: 'x', url: '', label: 'X', iconUrl: null }
          ],
          iconSize: 32,
          spacing: 14
        }
      };
    case 'footer':
      return {
        ...base,
        type,
        props: {
          addressHtml: '',
          permissionReminder: "You're receiving this because you subscribed to our emails.",
          includeUnsubscribe: true,
          unsubscribeLabel: 'Unsubscribe'
        }
      };
  }
}

export function createRow(columnCount: number, widths?: number[]): EmailRow {
  const count = Math.min(4, Math.max(1, columnCount));
  const columnWidths = widths && widths.length === count ? widths : new Array(count).fill(100 / count);
  return {
    id: newDesignId(),
    columns: columnWidths.map((widthPercent) => ({
      id: newDesignId(),
      widthPercent,
      blocks: []
    })),
    styles: { ...createDefaultBlockStyles(), padding: { top: 0, right: 0, bottom: 0, left: 0 } },
    mobileStyles: {},
    stylesLinked: true
  };
}

export function createSection(kind: SectionKind, name?: string | null): EmailSection {
  return { id: newDesignId(), kind, name: name ?? null, backgroundColor: null, rows: [] };
}

// Default hosted icon images for the social block's compiled output, used
// whenever a network entry has no explicit iconUrl. Uploaded once to the
// shared Storage bucket (email-assets/social/) - see
// scripts/upload-social-icons.js. Empty string = no asset yet, compiler
// falls back to a text link.
export const DEFAULT_SOCIAL_ICON_URLS: Record<SocialNetwork, string> = {
  facebook: 'https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8.appspot.com/o/email-assets%2Fsocial%2Ffacebook.png?alt=media&token=61481638-1a95-4a75-b302-8a881fd18b6b',
  instagram: 'https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8.appspot.com/o/email-assets%2Fsocial%2Finstagram.png?alt=media&token=5766e636-6dd4-407d-bfc9-2be655386c58',
  x: 'https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8.appspot.com/o/email-assets%2Fsocial%2Fx.png?alt=media&token=b7f2e915-8055-44c8-a10e-95fe07c7306f',
  youtube: 'https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8.appspot.com/o/email-assets%2Fsocial%2Fyoutube.png?alt=media&token=76af84c1-205f-4f3a-aa55-fe05c6184709',
  linkedin: 'https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8.appspot.com/o/email-assets%2Fsocial%2Flinkedin.png?alt=media&token=2809e135-94a0-488d-b8cb-6b44419643d2',
  tiktok: 'https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8.appspot.com/o/email-assets%2Fsocial%2Ftiktok.png?alt=media&token=6e956bb6-0979-40b0-b380-9337de13c310',
  custom: ''
};

export function createDefaultDesign(): EmailDesign {
  return {
    version: EMAIL_DESIGN_VERSION,
    contentWidth: 600,
    globalStyles: { desktop: createDefaultGlobalStyles(), mobile: {} },
    sections: [createSection('header'), createSection('body'), createSection('footer')]
  };
}

// Imports a legacy (Quill-authored, html-only) template into the builder:
// the whole document becomes one full-width text block in the body, styled
// left-aligned like the original flowed content. The template only BECOMES
// a builder template when saved from the designer (which then stamps
// `design` and recompiles `html`); merely opening it changes nothing.
export function createDesignFromLegacyHtml(html: string): EmailDesign {
  const design = createDefaultDesign();
  const row = createRow(1);
  const block = createBlock('text');
  if (block.type === 'text') {
    block.props.html = html ?? '';
  }
  block.styles.align = 'left';
  row.columns[0].blocks = [block];
  design.sections[1].rows = [row];
  return design;
}

// Imports a FULL email document (a past sent email from `campaign_emails`,
// e.g. a Mailchimp-rendered campaign) as one full-width HTML block: head
// <style> blocks + body content are extracted (nesting a second <html>
// document inside the builder's own skeleton would be invalid) and scripts
// stripped. Client twin of import-mailchimp-campaigns.js's (removed)
// designWithHtmlBlock()/extractEmbeddable() - keep them in sync.
export function createDesignFromFullHtml(fullHtml: string): EmailDesign {
  const source = fullHtml ?? '';
  const styles = (source.match(/<style[\s\S]*?<\/style>/gi) ?? []).join('\n');
  const bodyMatch = source.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const embeddable = (styles + '\n' + (bodyMatch ? bodyMatch[1] : source))
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .trim();

  const design = createDefaultDesign();
  const row = createRow(1);
  const block = createBlock('html');
  if (block.type === 'html') {
    block.props.html = embeddable;
  }
  row.columns[0].blocks = [block];
  design.sections[1].rows = [row];
  return design;
}

// One resolver for "what styles actually apply on phones", shared by the
// canvas renderers and the HTML compiler so the editor preview and the sent
// email can never disagree.
export function resolveMobileStyles(styled: {
  styles: BlockStyles;
  mobileStyles: Partial<BlockStyles>;
  stylesLinked: boolean;
}): BlockStyles {
  if (styled.stylesLinked) {
    return styled.styles;
  }
  return { ...styled.styles, ...styled.mobileStyles };
}

export function resolveMobileGlobalStyles(design: EmailDesign): GlobalStyleSet {
  return { ...design.globalStyles.desktop, ...design.globalStyles.mobile };
}
