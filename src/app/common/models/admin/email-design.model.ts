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
  | 'footer';

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
  border: BlockBorder | null; // null = no border
  borderRadius: BoxCorners;
  backgroundColor: string | null; // null = transparent / inherit section
  align: BlockAlign;
}

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
}

export interface HeadingBlock extends EmailBlockBase {
  type: 'heading';
  props: { html: string; level: 1 | 2 | 3 | 4 };
}

export interface TextBlock extends EmailBlockBase {
  type: 'text';
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
  | FooterBlock;

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
  backgroundColor: string | null; // null = body background
  rows: EmailRow[];
}

export interface EmailDesign {
  version: number;
  contentWidth: number; // 600
  globalStyles: { desktop: GlobalStyleSet; mobile: Partial<GlobalStyleSet> };
  sections: EmailSection[]; // always [header, body, footer]
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
    border: null,
    borderRadius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
    backgroundColor: null,
    align: 'center'
  };
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
    stylesLinked: true
  };
  switch (type) {
    case 'heading':
      return { ...base, type, props: { html: 'Add a heading', level: 2 } };
    case 'text':
      return { ...base, type, props: { html: '<p>Add your text here.</p>' } };
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

export function createSection(kind: SectionKind): EmailSection {
  return { id: newDesignId(), kind, backgroundColor: null, rows: [] };
}

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
