// Built-in starter designs for the email builder's "start from" gallery.
// Each entry is a FACTORY, not a shared instance - every use gets fresh ids
// so two emails started from the same starter never collide.

import {
  EmailDesign,
  EmailRow,
  FooterBlock,
  HeadingBlock,
  TextBlock,
  createBlock,
  createDefaultDesign,
  createRow
} from '../../models/admin/email-design.model';

export interface StarterTemplate {
  id: string;
  name: string;
  description: string;
  build: () => EmailDesign;
}

function rowWith(...blockTypes: Parameters<typeof createBlock>[0][]): EmailRow {
  const row = createRow(1);
  row.columns[0].blocks = blockTypes.map((type) => createBlock(type));
  return row;
}

function buildBlank(): EmailDesign {
  return createDefaultDesign();
}

function buildSimpleNewsletter(): EmailDesign {
  const design = createDefaultDesign();
  const [header, body, footer] = design.sections;

  header.backgroundColor = '#f7f9fb';
  header.rows = [rowWith('logo')];

  const heading = createBlock('heading') as HeadingBlock;
  heading.props = { html: 'Hello *|FNAME|*!', level: 2 };

  const intro = createBlock('text') as TextBlock;
  intro.props = { html: '<p>Write your update here. This starter has an image, a heading, text, and a button ready to go.</p>' };

  const imageRow = rowWith('image');
  const contentRow = createRow(1);
  contentRow.columns[0].blocks = [heading, intro, createBlock('button')];
  body.rows = [imageRow, contentRow, rowWith('divider')];

  const footerBlock = createBlock('footer') as FooterBlock;
  footer.backgroundColor = '#f0f2f5';
  footer.rows = [rowWith('social')];
  footer.rows[0].columns[0].blocks.push(footerBlock);

  return design;
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: 'blank',
    name: 'Blank',
    description: 'Empty header, body, and footer sections.',
    build: buildBlank
  },
  {
    id: 'simple-newsletter',
    name: 'Simple newsletter',
    description: 'Logo, hero image, greeting with merge tag, button, social + footer.',
    build: buildSimpleNewsletter
  }
];
