import {
  ButtonBlock,
  EmailDesign,
  HeadingBlock,
  ImageBlock,
  SpacerBlock,
  TextBlock,
  VideoBlock,
  createBlock,
  createDefaultDesign,
  createRow
} from '../../models/admin/email-design.model';
import { compileEmailDesign, escapeEmailHtml } from './email-design-compiler';

function designWithBodyRow(row: ReturnType<typeof createRow>): EmailDesign {
  const design = createDefaultDesign();
  design.sections[1].rows = [row];
  return design;
}

function bodyRowWithBlocks(...blocks: ReturnType<typeof createBlock>[]): EmailDesign {
  const row = createRow(1);
  row.columns[0].blocks = blocks;
  return designWithBodyRow(row);
}

describe('compileEmailDesign', () => {
  it('emits the email skeleton: doctype, 600px content table, MSO conditionals', () => {
    const html = compileEmailDesign(createDefaultDesign());
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('max-width:600px');
    expect(html).toContain('<!--[if mso]>');
    expect(html).toContain('OfficeDocumentSettings');
    expect(html).toContain('@media (max-width: 620px)');
  });

  it('paints the email and body backgrounds from global styles', () => {
    const design = createDefaultDesign();
    design.globalStyles.desktop.emailBackgroundColor = '#112233';
    design.globalStyles.desktop.bodyBackgroundColor = '#fffefd';
    const html = compileEmailDesign(design);
    expect(html).toContain('background-color:#112233');
    expect(html).toContain('background-color:#fffefd');
  });

  it('renders all three sections with data-section markers', () => {
    const html = compileEmailDesign(createDefaultDesign());
    expect(html).toContain('data-section="header"');
    expect(html).toContain('data-section="body"');
    expect(html).toContain('data-section="footer"');
  });

  it('renders a heading with the global size for its level', () => {
    const heading = createBlock('heading') as HeadingBlock;
    heading.props = { html: 'Big News', level: 1 };
    const design = bodyRowWithBlocks(heading);
    design.globalStyles.desktop.heading.sizes.h1 = 31;
    const html = compileEmailDesign(design);
    expect(html).toContain('<h1');
    expect(html).toContain('font-size:31px');
    expect(html).toContain('Big News');
  });

  it('serializes block padding, border, radius, and background inline', () => {
    const text = createBlock('text') as TextBlock;
    text.styles.padding = { top: 1, right: 2, bottom: 3, left: 4 };
    text.styles.border = { width: 2, style: 'dashed', color: '#ff0000' };
    text.styles.borderRadius = { topLeft: 5, topRight: 6, bottomRight: 7, bottomLeft: 8 };
    text.styles.backgroundColor = '#abcdef';
    const html = compileEmailDesign(bodyRowWithBlocks(text));
    expect(html).toContain('padding:1px 2px 3px 4px;');
    expect(html).toContain('border:2px dashed #ff0000;');
    expect(html).toContain('border-radius:5px 6px 7px 8px;');
    expect(html).toContain('background-color:#abcdef;');
  });

  it('inlines the global link color onto anchors in text blocks', () => {
    const text = createBlock('text') as TextBlock;
    text.props.html = '<p>See <a href="https://example.com">this</a></p>';
    const design = bodyRowWithBlocks(text);
    design.globalStyles.desktop.link.color = '#123123';
    const html = compileEmailDesign(design);
    expect(html).toContain('<a style="color:#123123;');
  });

  it('renders a button as a padded link with global defaults', () => {
    const button = createBlock('button') as ButtonBlock;
    button.props.label = 'Register Now';
    button.props.href = 'https://example.com/go';
    const html = compileEmailDesign(bodyRowWithBlocks(button));
    expect(html).toContain('href="https://example.com/go"');
    expect(html).toContain('Register Now');
    expect(html).toContain('background-color:#1f3a5f'); // default global button bg
    expect(html).toContain('text-decoration:none');
  });

  it('renders images with escaped attributes and pixel width', () => {
    const image = createBlock('image') as ImageBlock;
    image.props.src = 'https://example.com/pic.jpg?a=1&b=2';
    image.props.alt = 'A "great" photo';
    const html = compileEmailDesign(bodyRowWithBlocks(image));
    expect(html).toContain('src="https://example.com/pic.jpg?a=1&amp;b=2"');
    expect(html).toContain('alt="A &quot;great&quot; photo"');
    expect(html).toMatch(/<img [^>]*width="\d+"/);
  });

  it('caps original-size images at their natural width', () => {
    const image = createBlock('image') as ImageBlock;
    image.props.src = 'https://example.com/pic.jpg';
    image.props.sizing = 'original';
    image.props.naturalWidth = 200;
    const html = compileEmailDesign(bodyRowWithBlocks(image));
    expect(html).toContain('width="200"');
  });

  it('renders a spacer as a fixed-height element', () => {
    const spacer = createBlock('spacer') as SpacerBlock;
    spacer.props.height = 37;
    const html = compileEmailDesign(bodyRowWithBlocks(spacer));
    expect(html).toContain('height:37px');
  });

  it('renders multi-column rows with stack-col divs and MSO ghost cells', () => {
    const row = createRow(2);
    row.columns[0].blocks = [createBlock('text')];
    row.columns[1].blocks = [createBlock('text')];
    const html = compileEmailDesign(designWithBodyRow(row));
    expect(html.match(/class="stack-col"/g)!.length).toBe(2);
    expect(html).toContain('<!--[if mso]><td width=');
    expect(html).toContain('width:50%');
  });

  it('supports 4 columns', () => {
    const row = createRow(4);
    row.columns.forEach((column) => (column.blocks = [createBlock('text')]));
    const html = compileEmailDesign(designWithBodyRow(row));
    expect(html.match(/class="stack-col"/g)!.length).toBe(4);
  });

  it('emits mobile override classes only for unlinked blocks with real diffs', () => {
    const text = createBlock('text') as TextBlock;
    text.stylesLinked = false;
    text.mobileStyles = { padding: { top: 99, right: 98, bottom: 97, left: 96 } };
    const linked = createBlock('text') as TextBlock;
    const html = compileEmailDesign(bodyRowWithBlocks(text, linked));
    expect(html).toContain(`.m-${text.id}{padding:99px 98px 97px 96px !important;}`);
    expect(html).not.toContain(`.m-${linked.id}{`);
  });

  it('passes merge tags through untouched', () => {
    const text = createBlock('text') as TextBlock;
    text.props.html = '<p>Hi *|FNAME|*, from {{Sender First Name}}</p>';
    const html = compileEmailDesign(bodyRowWithBlocks(text));
    expect(html).toContain('*|FNAME|*');
    expect(html).toContain('{{Sender First Name}}');
  });

  it('renders the footer unsubscribe link against the *|UNSUB|* merge tag', () => {
    const html = compileEmailDesign(bodyRowWithBlocks(createBlock('footer')));
    expect(html).toContain('href="*|UNSUB|*"');
    expect(html).toContain('Unsubscribe');
  });

  it('renders video blocks as a linked thumbnail with a watch link, never an embed', () => {
    const video = createBlock('video') as VideoBlock;
    video.props.url = 'https://www.youtube.com/watch?v=abc123';
    video.props.thumbnailUrl = 'https://img.youtube.com/vi/abc123/hqdefault.jpg';
    const html = compileEmailDesign(bodyRowWithBlocks(video));
    expect(html).toContain('href="https://www.youtube.com/watch?v=abc123"');
    expect(html).toContain('img.youtube.com/vi/abc123');
    expect(html).not.toContain('<iframe');
  });

  it('escapes the document title', () => {
    const html = compileEmailDesign(createDefaultDesign(), { title: 'A <b>&</b> B' });
    expect(html).toContain('<title>A &lt;b&gt;&amp;&lt;/b&gt; B</title>');
  });

  // ---- P1 gap-closure features ----

  it('compiles margin as transparent padding on an outer wrapper cell', () => {
    const text = createBlock('text') as TextBlock;
    text.styles.margin = { top: 5, right: 6, bottom: 7, left: 8 };
    const html = compileEmailDesign(bodyRowWithBlocks(text));
    expect(html).toContain('padding:5px 6px 7px 8px;');
  });

  it('excludes hidden blocks from the compiled email entirely', () => {
    const text = createBlock('text') as TextBlock;
    text.props.html = '<p>secret-draft-content</p>';
    text.hidden = true;
    const html = compileEmailDesign(bodyRowWithBlocks(text));
    expect(html).not.toContain('secret-draft-content');
  });

  it('emits hide-on-mobile and hide-on-desktop visibility rules', () => {
    const mobileHidden = createBlock('text') as TextBlock;
    mobileHidden.hideOnMobile = true;
    const desktopHidden = createBlock('text') as TextBlock;
    desktopHidden.hideOnDesktop = true;
    const html = compileEmailDesign(bodyRowWithBlocks(mobileHidden, desktopHidden));
    expect(html).toContain(`hide-mob-${mobileHidden.id}`);
    expect(html).toContain(`.hide-mob-${mobileHidden.id}{display:none !important`);
    expect(html).toContain(`show-mob-${desktopHidden.id}`);
    expect(html).toContain('mso-hide:all');
    expect(html).toContain(`.show-mob-${desktopHidden.id}{display:table !important`);
  });

  it('renders a hidden preheader div when preview text is set', () => {
    const design = createDefaultDesign();
    design.preheader = 'The inbox snippet line';
    const html = compileEmailDesign(design);
    expect(html).toContain('The inbox snippet line');
    expect(html).toMatch(/<div style="display:none[^>]*>The inbox snippet line/);
  });

  it('omits the preheader div when preview text is empty', () => {
    const design = createDefaultDesign();
    design.preheader = '   ';
    const html = compileEmailDesign(design);
    expect(html).not.toContain('display:none;font-size:1px');
  });

  it('passes an html block through untouched', () => {
    const raw = createBlock('html');
    if (raw.type === 'html') {
      raw.props.html = '<table><tr><td>custom-markup</td></tr></table>';
    }
    const html = compileEmailDesign(bodyRowWithBlocks(raw));
    expect(html).toContain('<table><tr><td>custom-markup</td></tr></table>');
  });

  it('honors a per-block font family over the global default', () => {
    const text = createBlock('text') as TextBlock;
    text.props.fontFamily = 'Courier New, Courier, monospace';
    const html = compileEmailDesign(bodyRowWithBlocks(text));
    expect(html).toContain('font-family:Courier New, Courier, monospace');
  });
});

describe('escapeEmailHtml', () => {
  it('escapes the five HTML special characters', () => {
    expect(escapeEmailHtml(`<a href="x">&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;'
    );
  });

  it('tolerates null input', () => {
    expect(escapeEmailHtml(null as unknown as string)).toBe('');
  });
});
