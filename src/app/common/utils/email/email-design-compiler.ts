// Compiles an EmailDesign document into email-client-safe HTML: 600px
// centered table layout, everything inline-styled, MSO (Outlook) conditional
// ghost tables for multi-column rows, and a single <style> block whose only
// jobs are table resets plus the @media rules that stack columns and apply
// unlinked mobile overrides on phones.
//
// PURE TS - no Angular, no DOM, no environment imports; string building
// only. This keeps it mirrorable into functions/src/ (the same manual
// mirroring pattern as html-to-text.ts / transactional-emails.ts) for the
// day Cloud Functions need to recompile designs server-side.
//
// Merge tags (*|FNAME|* etc., and legacy {{...}} tokens) pass through
// UNTOUCHED - substitution is a send/preview-time concern (merge-tags.ts).
//
// Known, deliberate fidelity degradations (the same class of compromises
// Mailchimp's own exports make):
// - Outlook desktop ignores border-radius on buttons (no VML fallback).
// - Outlook desktop ignores the @media mobile overrides; its ghost tables
//   still render correct fixed-width columns.
// - Video is a linked thumbnail + "Watch video" button row; email clients
//   cannot embed real players.

import {
  BlockStyles,
  ButtonBlock,
  DEFAULT_SOCIAL_ICON_URLS,
  DividerBlock,
  EmailBlock,
  EmailColumn,
  EmailDesign,
  EmailRow,
  EmailSection,
  FooterBlock,
  GlobalStyleSet,
  HeadingBlock,
  HtmlBlock,
  ImageBlock,
  ImageProps,
  LogoBlock,
  SocialBlock,
  SpacerBlock,
  TextBlock,
  VideoBlock,
  ZERO_SIDES,
  resolveMobileGlobalStyles,
  resolveMobileStyles
} from '../../models/admin/email-design.model';

export interface CompileOptions {
  title?: string;
}

export function escapeEmailHtml(value: string): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------- css bits

function paddingCss(styles: BlockStyles): string {
  const p = styles.padding;
  return `padding:${p.top}px ${p.right}px ${p.bottom}px ${p.left}px;`;
}

function borderCss(styles: BlockStyles): string {
  const b = styles.border;
  if (!b || b.width <= 0) {
    return '';
  }
  return `border:${b.width}px ${b.style} ${b.color};`;
}

function radiusCss(styles: BlockStyles): string {
  const r = styles.borderRadius;
  if (r.topLeft === 0 && r.topRight === 0 && r.bottomRight === 0 && r.bottomLeft === 0) {
    return '';
  }
  return `border-radius:${r.topLeft}px ${r.topRight}px ${r.bottomRight}px ${r.bottomLeft}px;`;
}

function backgroundCss(styles: BlockStyles): string {
  return styles.backgroundColor ? `background-color:${styles.backgroundColor};` : '';
}

function blockTdCss(styles: BlockStyles): string {
  return (
    paddingCss(styles) +
    backgroundCss(styles) +
    borderCss(styles) +
    radiusCss(styles) +
    `text-align:${styles.align};`
  );
}

// The @media diff for one unlinked row/block: only the properties that
// actually differ from desktop, each !important so they beat inline styles.
function mobileDiffCss(desktop: BlockStyles, mobile: BlockStyles): string {
  const rules: string[] = [];
  const dp = desktop.padding;
  const mp = mobile.padding;
  if (dp.top !== mp.top || dp.right !== mp.right || dp.bottom !== mp.bottom || dp.left !== mp.left) {
    rules.push(`padding:${mp.top}px ${mp.right}px ${mp.bottom}px ${mp.left}px !important`);
  }
  if (desktop.backgroundColor !== mobile.backgroundColor) {
    rules.push(`background-color:${mobile.backgroundColor ?? 'transparent'} !important`);
  }
  if (desktop.align !== mobile.align) {
    rules.push(`text-align:${mobile.align} !important`);
  }
  return rules.join(';');
}

// ---------------------------------------------------------------- inline html

// Text/heading/footer fragments are authored HTML (already normalized by the
// editor). Email clients don't cascade the wrapper's link color into <a>
// tags, so inline it onto anchors that don't already carry a style.
function inlineLinkStyles(html: string, global: GlobalStyleSet): string {
  const linkCss = `color:${global.link.color};text-decoration:${global.link.underline ? 'underline' : 'none'};`;
  return (html ?? '').replace(/<a (?![^>]*style=)/g, `<a style="${linkCss}" `);
}

// ---------------------------------------------------------------- blocks

interface RenderContext {
  global: GlobalStyleSet;
  columnWidth: number; // px available to the block, before its own padding
}

function renderHeading(block: HeadingBlock, ctx: RenderContext): string {
  const h = ctx.global.heading;
  const sizeByLevel = { 1: h.sizes.h1, 2: h.sizes.h2, 3: h.sizes.h3, 4: h.sizes.h4 };
  const size = sizeByLevel[block.props.level];
  const tag = 'h' + block.props.level;
  const family = block.props.fontFamily ?? h.fontFamily;
  return (
    `<${tag} class="eml-h" style="margin:0;font-family:${family};` +
    `font-size:${size}px;line-height:1.25;color:${h.color};">` +
    inlineLinkStyles(block.props.html, ctx.global) +
    `</${tag}>`
  );
}

function renderText(block: TextBlock, ctx: RenderContext): string {
  const p = ctx.global.paragraph;
  const family = block.props.fontFamily ?? p.fontFamily;
  return (
    `<div class="eml-p" style="font-family:${family};font-size:${p.fontSize}px;` +
    `line-height:${p.lineHeight};color:${p.color};">` +
    inlineLinkStyles(block.props.html, ctx.global) +
    `</div>`
  );
}

// Raw-markup passthrough: sanitized (scripts stripped) at edit time by the
// designer; the compiler trusts it as authored.
function renderHtml(block: HtmlBlock): string {
  return block.props.html ?? '';
}

function imageWidth(props: ImageProps, available: number): number {
  if (props.sizing === 'scale') {
    return Math.round((available * Math.min(100, Math.max(10, props.scalePercent))) / 100);
  }
  if (props.sizing === 'original' && props.naturalWidth) {
    return Math.min(props.naturalWidth, available);
  }
  return available;
}

function renderImage(block: ImageBlock | LogoBlock, ctx: RenderContext): string {
  const props = block.props;
  const width = imageWidth(props, ctx.columnWidth - block.styles.padding.left - block.styles.padding.right);
  if (!props.src) {
    return (
      `<div style="background-color:#eef1f4;color:#8a93a0;font-family:Helvetica,Arial,sans-serif;` +
      `font-size:12px;text-align:center;padding:40px 0;">Image</div>`
    );
  }
  const img =
    `<img src="${escapeEmailHtml(props.src)}" alt="${escapeEmailHtml(props.alt)}" width="${width}" ` +
    `style="display:inline-block;width:${width}px;max-width:100%;height:auto;border:0;${radiusCss(block.styles)}">`;
  if (!props.href) {
    return img;
  }
  const target = props.openInNewTab ? ' target="_blank"' : '';
  return `<a href="${escapeEmailHtml(props.href)}"${target}>${img}</a>`;
}

function renderButton(block: ButtonBlock, ctx: RenderContext): string {
  const d = ctx.global.button;
  const bg = block.props.backgroundColor ?? d.backgroundColor;
  const color = block.props.color ?? d.color;
  const radius = block.props.borderRadius ?? d.borderRadius;
  const fontSize = block.props.fontSize ?? d.fontSize;
  const pad = d.padding;
  const widthAttr = block.props.fullWidth ? ' width="100%"' : '';
  const display = block.props.fullWidth ? 'block' : 'inline-block';
  return (
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0"${widthAttr} ` +
    `style="display:${block.props.fullWidth ? 'table' : 'inline-table'};"><tr>` +
    `<td bgcolor="${bg}" style="background-color:${bg};border-radius:${radius}px;text-align:center;">` +
    `<a href="${escapeEmailHtml(block.props.href || '#')}" class="eml-btn" ` +
    `style="display:${display};padding:${pad.top}px ${pad.right}px ${pad.bottom}px ${pad.left}px;` +
    `font-family:Helvetica,Arial,sans-serif;font-size:${fontSize}px;font-weight:bold;` +
    `color:${color};text-decoration:none;border-radius:${radius}px;text-align:center;">` +
    escapeEmailHtml(block.props.label) +
    `</a></td></tr></table>`
  );
}

function renderDivider(block: DividerBlock, ctx: RenderContext): string {
  const d = ctx.global.divider;
  const style = block.props.style ?? d.style;
  const thickness = block.props.thickness ?? d.thickness;
  const color = block.props.color ?? d.color;
  return `<div style="border-top:${thickness}px ${style} ${color};font-size:0;line-height:0;">&nbsp;</div>`;
}

function renderSpacer(block: SpacerBlock): string {
  const h = Math.max(1, block.props.height);
  return `<div style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</div>`;
}

function renderVideo(block: VideoBlock, ctx: RenderContext): string {
  const props = block.props;
  const href = escapeEmailHtml(props.url || '#');
  const caption = escapeEmailHtml(props.caption || 'Watch video');
  const width = ctx.columnWidth - block.styles.padding.left - block.styles.padding.right;
  const thumb = props.thumbnailUrl
    ? `<img src="${escapeEmailHtml(props.thumbnailUrl)}" alt="${caption}" width="${width}" ` +
      `style="display:block;width:100%;max-width:${width}px;height:auto;border:0;${radiusCss(block.styles)}">`
    : `<div style="background-color:#17202e;color:#cfd6df;font-family:Helvetica,Arial,sans-serif;` +
      `font-size:13px;text-align:center;padding:70px 0;${radiusCss(block.styles)}">&#9658;&nbsp;&nbsp;${caption}</div>`;
  const d = ctx.global.button;
  return (
    `<a href="${href}" target="_blank" style="text-decoration:none;">${thumb}</a>` +
    `<div style="padding-top:10px;text-align:center;">` +
    `<a href="${href}" target="_blank" style="display:inline-block;font-family:Helvetica,Arial,sans-serif;` +
    `font-size:13px;font-weight:bold;color:${d.backgroundColor};text-decoration:none;">&#9658;&nbsp;${caption}</a>` +
    `</div>`
  );
}

function renderSocial(block: SocialBlock): string {
  const items = block.props.networks
    .map((n) => {
      const href = escapeEmailHtml(n.url || '#');
      // Per-network explicit icon, else the shared hosted default set,
      // else a text link.
      const iconUrl = n.iconUrl || DEFAULT_SOCIAL_ICON_URLS[n.network] || '';
      const inner = iconUrl
        ? `<img src="${escapeEmailHtml(iconUrl)}" alt="${escapeEmailHtml(n.label)}" ` +
          `width="${block.props.iconSize}" height="${block.props.iconSize}" ` +
          `style="display:inline-block;border:0;border-radius:6px;">`
        : escapeEmailHtml(n.label);
      return (
        `<a href="${href}" target="_blank" style="display:inline-block;margin:0 ${Math.round(block.props.spacing / 2)}px;` +
        `font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:bold;color:#1f2430;text-decoration:none;">` +
        inner +
        `</a>`
      );
    })
    .join('');
  return `<div>${items}</div>`;
}

function renderFooter(block: FooterBlock, ctx: RenderContext): string {
  const props = block.props;
  const p = ctx.global.paragraph;
  const small = `font-family:${p.fontFamily};font-size:12px;line-height:1.6;color:#6a7280;`;
  const parts: string[] = [];
  if (props.addressHtml) {
    parts.push(`<div style="${small}">${inlineLinkStyles(props.addressHtml, ctx.global)}</div>`);
  }
  if (props.permissionReminder) {
    parts.push(`<div style="${small}padding-top:6px;">${escapeEmailHtml(props.permissionReminder)}</div>`);
  }
  if (props.includeUnsubscribe) {
    parts.push(
      `<div style="padding-top:6px;"><a href="*|UNSUB|*" style="${small}color:${ctx.global.link.color};` +
        `text-decoration:underline;">${escapeEmailHtml(props.unsubscribeLabel || 'Unsubscribe')}</a></div>`
    );
  }
  return parts.join('');
}

function renderBlockInner(block: EmailBlock, ctx: RenderContext): string {
  switch (block.type) {
    case 'heading':
      return renderHeading(block, ctx);
    case 'text':
      return renderText(block, ctx);
    case 'image':
    case 'logo':
      return renderImage(block, ctx);
    case 'button':
      return renderButton(block, ctx);
    case 'divider':
      return renderDivider(block, ctx);
    case 'spacer':
      return renderSpacer(block);
    case 'video':
      return renderVideo(block, ctx);
    case 'social':
      return renderSocial(block);
    case 'footer':
      return renderFooter(block, ctx);
    case 'html':
      return renderHtml(block);
  }
}

function renderBlock(block: EmailBlock, ctx: RenderContext): string {
  // Hidden entirely: excluded from the compiled email (Mailchimp's
  // slashed-eye semantics - grayed on canvas, absent from sends).
  if (block.hidden) {
    return '';
  }

  const margin = block.styles.margin ?? ZERO_SIDES;
  const hasMargin = margin.top || margin.right || margin.bottom || margin.left;

  // hideOnDesktop: hidden inline (desktop clients + Outlook via the mso
  // conditional), un-hidden on phones by the @media rule buildMobileCss()
  // emits for .show-mob-<id>. hideOnMobile: visible inline, hidden by the
  // @media rule for .hide-mob-<id>.
  const visibilityClass = block.hideOnMobile ?
    ` hide-mob-${block.id}` :
    (block.hideOnDesktop ? ` show-mob-${block.id}` : '');
  const desktopHiddenCss = block.hideOnDesktop ?
    'display:none;max-height:0;overflow:hidden;mso-hide:all;' : '';

  // Buttons and social rows center via the td's text-align; images too.
  const inner =
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"><tr>` +
    `<td class="m-${block.id}" align="${block.styles.align}" style="${blockTdCss(block.styles)}">` +
    renderBlockInner(block, ctx) +
    `</td></tr></table>`;

  // Margin = transparent padding on an OUTER wrapper cell, so it sits
  // outside the block's own background/border (real margins are unreliable
  // in email clients). The wrapper also carries the visibility class.
  if (hasMargin || visibilityClass || desktopHiddenCss) {
    const marginCss = hasMargin ?
      `padding:${margin.top}px ${margin.right}px ${margin.bottom}px ${margin.left}px;` : '';
    return (
      `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"` +
      ` class="blk-${block.id}${visibilityClass}" style="${desktopHiddenCss}"><tr>` +
      `<td style="${marginCss}">` + inner + `</td></tr></table>`
    );
  }
  return inner;
}

// ---------------------------------------------------------------- layout

function renderColumn(column: EmailColumn, ctx: RenderContext): string {
  return column.blocks.map((block) => renderBlock(block, ctx)).join('');
}

function renderRow(row: EmailRow, global: GlobalStyleSet, contentWidth: number): string {
  const rowInnerWidth = contentWidth - row.styles.padding.left - row.styles.padding.right;
  const open =
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"><tr>` +
    `<td class="m-${row.id}" style="${paddingCss(row.styles)}${backgroundCss(row.styles)}` +
    // font-size:0 kills the whitespace gaps between inline-block columns.
    (row.columns.length > 1 ? 'font-size:0;' : '') +
    `">`;
  const close = `</td></tr></table>`;

  if (row.columns.length === 1) {
    return open + renderColumn(row.columns[0], { global, columnWidth: rowInnerWidth }) + close;
  }

  const columnPx = row.columns.map((column) => Math.round((rowInnerWidth * column.widthPercent) / 100));
  const msoOpen = `<!--[if mso]><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="${rowInnerWidth}"><tr><![endif]-->`;
  const msoClose = `<!--[if mso]></tr></table><![endif]-->`;
  const columns = row.columns
    .map((column, index) => {
      const px = columnPx[index];
      return (
        `<!--[if mso]><td width="${px}" valign="top"><![endif]-->` +
        `<div class="stack-col" style="display:inline-block;width:${column.widthPercent}%;` +
        `max-width:${px}px;vertical-align:top;font-size:14px;">` +
        renderColumn(column, { global, columnWidth: px }) +
        `</div>` +
        `<!--[if mso]></td><![endif]-->`
      );
    })
    .join('');
  return open + msoOpen + columns + msoClose + close;
}

function renderSection(section: EmailSection, global: GlobalStyleSet, contentWidth: number): string {
  const bg = section.backgroundColor ? `background-color:${section.backgroundColor};` : '';
  return (
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" ` +
    `data-section="${section.kind}" style="${bg}"><tr><td>` +
    section.rows.map((row) => renderRow(row, global, contentWidth)).join('') +
    `</td></tr></table>`
  );
}

// ---------------------------------------------------------------- media css

function buildMobileCss(design: EmailDesign): string {
  const rules: string[] = [
    '.stack-col{width:100% !important;max-width:100% !important;display:block !important;}'
  ];

  const mobileGlobal = resolveMobileGlobalStyles(design);
  const desktopGlobal = design.globalStyles.desktop;
  if (mobileGlobal.paragraph.fontSize !== desktopGlobal.paragraph.fontSize) {
    rules.push(`.eml-p{font-size:${mobileGlobal.paragraph.fontSize}px !important;}`);
  }
  if (mobileGlobal.button.fontSize !== desktopGlobal.button.fontSize) {
    rules.push(`.eml-btn{font-size:${mobileGlobal.button.fontSize}px !important;}`);
  }

  for (const section of design.sections) {
    for (const row of section.rows) {
      if (!row.stylesLinked) {
        const diff = mobileDiffCss(row.styles, resolveMobileStyles(row));
        if (diff) {
          rules.push(`.m-${row.id}{${diff};}`);
        }
      }
      for (const column of row.columns) {
        for (const block of column.blocks) {
          if (!block.stylesLinked) {
            const diff = mobileDiffCss(block.styles, resolveMobileStyles(block));
            if (diff) {
              rules.push(`.m-${block.id}{${diff};}`);
            }
          }
          // Per-device visibility (see renderBlock's wrapper classes).
          if (block.hideOnMobile && !block.hidden) {
            rules.push(`.hide-mob-${block.id}{display:none !important;max-height:0 !important;overflow:hidden !important;}`);
          }
          if (block.hideOnDesktop && !block.hidden && !block.hideOnMobile) {
            rules.push(`.show-mob-${block.id}{display:table !important;max-height:none !important;overflow:visible !important;}`);
          }
        }
      }
    }
  }

  return `@media (max-width: 620px){${rules.join('')}}`;
}

// ---------------------------------------------------------------- document

export function compileEmailDesign(design: EmailDesign, opts?: CompileOptions): string {
  const global = design.globalStyles.desktop;
  const width = design.contentWidth;
  const title = escapeEmailHtml(opts?.title ?? '');

  const head =
    `<!doctype html>` +
    `<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">` +
    `<head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta http-equiv="X-UA-Compatible" content="IE=edge">` +
    `<title>${title}</title>` +
    `<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch>` +
    `</o:OfficeDocumentSettings></xml></noscript><![endif]-->` +
    `<style>` +
    `body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}` +
    `table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;}` +
    `img{-ms-interpolation-mode:bicubic;}` +
    buildMobileCss(design) +
    `</style>` +
    `</head>`;

  const sections = design.sections.map((section) => renderSection(section, global, width)).join('');

  // The inbox snippet line. Hidden in the rendered email but read by
  // clients as the preview text; the trailing zero-width/non-breaking
  // padding stops clients from pulling visible body copy in after it.
  const preheaderText = (design.preheader ?? '').trim();
  const preheader = preheaderText ?
    `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;` +
    `opacity:0;overflow:hidden;mso-hide:all;">` +
    escapeEmailHtml(preheaderText) +
    '&#8199;&#847;'.repeat(30) +
    `</div>` : '';

  const body =
    `<body style="margin:0;padding:0;background-color:${global.emailBackgroundColor};">` +
    preheader +
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" ` +
    `bgcolor="${global.emailBackgroundColor}" style="background-color:${global.emailBackgroundColor};">` +
    `<tr><td align="center" style="padding:24px 8px;">` +
    `<!--[if mso]><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="${width}"><tr><td><![endif]-->` +
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" ` +
    `style="max-width:${width}px;background-color:${global.bodyBackgroundColor};">` +
    `<tr><td>` +
    sections +
    `</td></tr></table>` +
    `<!--[if mso]></td></tr></table><![endif]-->` +
    `</td></tr></table>` +
    `</body></html>`;

  return head + body;
}
