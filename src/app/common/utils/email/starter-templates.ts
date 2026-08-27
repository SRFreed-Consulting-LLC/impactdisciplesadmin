// Built-in starter designs for the email builder's "start from" gallery.
// Each entry is a FACTORY, not a shared instance - every use gets fresh ids
// so two emails started from the same starter never collide.
//
// The five series starters below (Prayer Letter, Disciple-Making Minute,
// Blog Post, Monthly Newsletter, Podcast Episode) are not invented layouts:
// each was derived from the most recent real send of that campaign in
// production on 2026-08-21, matching its actual structure, section order,
// and voice. Notes on each are in its own builder. Images are left as
// placeholders on purpose - the copy is a scaffold to replace, not filler
// to ship.

import {
  ButtonBlock,
  EmailDesign,
  EmailRow,
  FooterBlock,
  HeadingBlock,
  ImageBlock,
  TextBlock,
  createBlock,
  createDefaultDesign,
  createRow
} from '../../models/admin/email-design.model';
import { ARCHIVE_SHELLS, ArchiveShell } from './archive-shells';
import { chromePieceById } from './chrome-pieces';

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

/** A one-column row holding blocks the caller has already configured. */
function rowOf(...blocks: ReturnType<typeof createBlock>[]): EmailRow {
  const row = createRow(1);
  row.columns[0].blocks = blocks;
  return row;
}

function heading(html: string, level: 1 | 2 | 3 | 4 = 2): HeadingBlock {
  const block = createBlock('heading') as HeadingBlock;
  block.props = { html, level, fontFamily: null };
  return block;
}

function text(html: string): TextBlock {
  const block = createBlock('text') as TextBlock;
  block.props = { html, fontFamily: null };
  return block;
}

function button(label: string, href: string): ButtonBlock {
  const block = createBlock('button') as ButtonBlock;
  block.props = {
    label,
    href,
    fullWidth: false,
    backgroundColor: null,
    color: null,
    borderRadius: null,
    fontSize: null
  };
  return block;
}

function image(alt: string): ImageBlock {
  const block = createBlock('image') as ImageBlock;
  block.props = { ...block.props, alt };
  return block;
}

/** The standard sign-off every series shares: social row then the footer
 *  block, which supplies the address and the unsubscribe link. */
function standardFooter(design: EmailDesign): void {
  const footer = design.sections[2];
  footer.backgroundColor = '#f4f4f4';
  const footerBlock = createBlock('footer') as FooterBlock;
  footer.rows = [rowWith('social')];
  footer.rows[0].columns[0].blocks.push(footerBlock);
}

function buildBlank(): EmailDesign {
  return createDefaultDesign();
}

function buildSimpleNewsletter(): EmailDesign {
  const design = createDefaultDesign();
  const [header, body] = design.sections;

  header.backgroundColor = '#f7f9fb';
  header.rows = [rowWith('logo')];

  const intro = text('<p>Write your update here. This starter has an image, a heading, text, and a button ready to go.</p>');
  body.rows = [
    rowWith('image'),
    rowOf(heading('Hello *|FNAME|*!'), intro, createBlock('button')),
    rowWith('divider')
  ];

  standardFooter(design);
  return design;
}

// Prayer Letter - modelled on "Join Us in Prayer for the Disciple-Making
// Summit" (Nov 2025). Shape: an uppercase hero calling out what to pray
// toward, a CTA to the thing itself, a personal note from Ken Adams, the
// month's prayer points, then a closing CTA.
function buildPrayerLetter(): EmailDesign {
  const design = createDefaultDesign();
  const [header, body] = design.sections;

  header.backgroundColor = '#f4f4f4';
  header.rows = [rowWith('logo')];

  body.rows = [
    rowOf(
      heading('PRAY AHEAD FOR [WHAT&rsquo;S COMING]', 1),
      text('<p>As we look toward the season ahead, we&rsquo;re asking God to use this moment to equip and encourage leaders across the movement.</p>'),
      button('LEARN MORE', 'https://impactdisciples.com/')
    ),
    rowOf(image('Photo from a recent gathering')),
    rowOf(
      heading('FROM THE DIRECTOR &amp; FOUNDER, KEN ADAMS', 3),
      text('<p>Write the personal note here &mdash; what you are grateful for, and what is on your heart for the movement this month.</p>')
    ),
    rowWith('divider'),
    rowOf(
      heading('HOW CAN YOU PRAY THIS MONTH'),
      text(
        '<ul>' +
        '<li>&#128329; Pray for the leaders preparing to teach.</li>' +
        '<li>&#128329; Pray for the churches deciding whether to come.</li>' +
        '<li>&#128329; Pray for every conversation that starts here.</li>' +
        '</ul>'
      )
    ),
    rowOf(
      heading('BE THE FIRST TO SEE WHAT&rsquo;S NEXT'),
      button('REGISTER HERE', 'https://impactdisciples.com/')
    )
  ];

  standardFooter(design);
  return design;
}

// Disciple-Making Minute - modelled on the June 2026 send. Deliberately
// plain: the real DMM carries no images and no buttons at all, just a
// title and four or five paragraphs of teaching. Keeping it that way is
// the point of having a starter for it.
function buildDiscipleMakingMinute(): EmailDesign {
  const design = createDefaultDesign();
  const [header, body] = design.sections;

  header.rows = [rowWith('logo')];

  body.rows = [
    rowOf(
      heading('Christlike Character: [Trait]', 1),
      text('<p>Open with the question the trait raises. Can people count on you? Do you follow through on what you say you will do?</p>'),
      text('<p>Say why it matters &mdash; what everyone expects of it, whether or not it is true of us.</p>'),
      text('<p>Turn to Jesus. As you read the Gospels, it does not take long to discover that Jesus displayed this. Show where.</p>'),
      text('<p>Land it on the reader: this should be a byproduct of a Spirit-controlled life, and a mark of a fully trained disciple.</p>')
    )
  ];

  // The DMM's own body text is left-aligned reading copy, not centred.
  for (const block of body.rows[0].columns[0].blocks) {
    block.styles.align = 'left';
  }

  standardFooter(design);
  return design;
}

// Blog Post - modelled on "*Blog* Disciple Making Pastor's Plan"
// (Feb 2024). One story: art, title, a two-sentence teaser, Read More.
function buildBlogPost(): EmailDesign {
  const design = createDefaultDesign();
  const [header, body] = design.sections;

  header.rows = [rowWith('logo')];

  body.rows = [
    rowOf(image('Blog post artwork')),
    rowOf(
      heading('[Blog Post Title]', 1),
      text('<p>Two sentences that make someone want the rest. Pose the question the post answers, then hint at the turn &mdash; do not give it away.</p>'),
      button('Read More', 'https://impactdisciples.com/')
    )
  ];

  standardFooter(design);
  return design;
}

// Monthly Newsletter - modelled on "Build Fully Trained Disciples (Beyond
// Impact One)" (Mar 2026). Several stacked story blocks, each art +
// headline + copy + its own CTA, closing on a giving ask.
function buildMonthlyNewsletter(): EmailDesign {
  const design = createDefaultDesign();
  const [header, body] = design.sections;

  header.backgroundColor = '#f4f4f4';
  header.rows = [rowWith('logo')];

  const story = (title: string, copy: string, cta: string): EmailRow[] => [
    rowOf(image(title)),
    rowOf(heading(title, 1), text(copy), button(cta, 'https://impactdisciples.com/'))
  ];

  body.rows = [
    ...story(
      '[Lead Story Headline]',
      '<p>The main thing this month. One short paragraph on what it is, then one on why it matters to a disciple-making church.</p>',
      'Learn More'
    ),
    rowWith('divider'),
    ...story(
      '[Second Story Headline]',
      '<p>A resource, a product, or a testimony. Keep it to a few lines &mdash; the button carries the rest.</p>',
      'View the Details'
    ),
    rowWith('divider'),
    rowOf(
      heading('Partner With Us'),
      text('<p>Every church strengthened is the fruit of people who pray and give.</p>'),
      button('GIVE TODAY', 'https://impactdisciples.com/give')
    )
  ];

  standardFooter(design);
  return design;
}

// Podcast Episode - modelled on "*Podcast* How Impact Groups Change Lives"
// (Jul 2026). Episode art, the episode title, the two listen paths, and
// the free resource tied to that episode.
function buildPodcastEpisode(): EmailDesign {
  const design = createDefaultDesign();
  const [header, body] = design.sections;

  header.rows = [rowWith('logo')];

  body.rows = [
    rowOf(image('S0X E0X - [Episode Title] ft. [Guest]')),
    rowOf(
      heading('[Episode Title]', 1),
      text('<p>One or two lines on what this conversation is about and who it is for.</p>'),
      button('&#128993; WATCH ON YOUTUBE', 'https://youtu.be/'),
      button('&#128993; LISTEN ON APPLE PODCASTS', 'https://podcasts.apple.com/')
    ),
    rowWith('divider'),
    rowOf(
      heading('FREE RESOURCE', 3),
      text('<p>The download that goes with this episode.</p>'),
      button('&#128993; DOWNLOAD THE FREE RESOURCE', 'https://impactdisciples.com/')
    )
  ];

  standardFooter(design);
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
    id: 'prayer-letter',
    name: 'Prayer Letter',
    description: 'Hero, note from Ken, this month’s prayer points, closing CTA.',
    build: buildPrayerLetter
  },
  {
    id: 'disciple-making-minute',
    name: 'Disciple-Making Minute',
    description: 'Text-only devotional — a character trait worked through in four beats.',
    build: buildDiscipleMakingMinute
  },
  {
    id: 'blog-post',
    name: 'Blog Post',
    description: 'Artwork, title, teaser, and a Read More button.',
    build: buildBlogPost
  },
  {
    id: 'monthly-newsletter',
    name: 'Monthly Newsletter',
    description: 'Two stacked stories with their own CTAs, closing on a giving ask.',
    build: buildMonthlyNewsletter
  },
  {
    id: 'podcast-episode',
    name: 'Podcast Episode',
    description: 'Episode art, watch and listen buttons, and the episode’s free resource.',
    build: buildPodcastEpisode
  },
  {
    id: 'simple-newsletter',
    name: 'Simple newsletter',
    description: 'Logo, hero image, greeting with merge tag, button, social + footer.',
    build: buildSimpleNewsletter
  }
];

/**
 * Shells mined from the real campaign archive (2025 onward), appended to the
 * hand-built starters above.
 *
 * These are the branded chrome that actually shipped - a header and footer
 * that went out together on more than one campaign - with an EMPTY body
 * between them. That is the point: an admin starting a new email gets the
 * masthead, the social row, the address and the unsubscribe already correct,
 * and writes only the part that differs.
 *
 * Kept as raw HTML blocks rather than reconstructed builder blocks. Mailchimp
 * chrome is deeply nested tables carrying its own inline styles, and taking it
 * apart into image/social/footer blocks would change how it renders - the
 * whole reason to reuse it is that it is known to survive real inboxes. The
 * html block is the builder's own escape hatch for exactly this.
 *
 * Regenerate ARCHIVE_SHELLS with scripts/extract-email-chrome.js.
 */
function buildArchiveShell(shell: ArchiveShell): EmailDesign {
  const design = createDefaultDesign();

  // The header and footer rows come from CHROME_PIECES rather than being
  // built again here: the designer's chrome palette drags the very same
  // pieces onto an existing design, and two definitions of "the row for
  // shell 3's footer" would drift the moment one of them was fixed.
  const rowFor = (id: string, fallbackHtml: string): EmailRow => {
    const piece = chromePieceById(id);
    if (piece) {
      return piece.build();
    }
    // Only reachable if a shell id stops matching its piece ids; a starter
    // rendering blank is worse than one built the long way.
    const row = createRow(1);
    const block = createBlock('html');
    if (block.type === 'html') {
      block.props.html = fallbackHtml;
    }
    row.columns[0].blocks = [block];
    return row;
  };

  design.sections[0].rows = [rowFor(`${shell.id}-header`, shell.header)];

  // One placeholder paragraph, not an empty body: an entirely empty middle
  // section gives nothing to click into, and the canvas would look broken.
  const body = createBlock('text');
  if (body.type === 'text') {
    body.props.html = '<p>Write your email here.</p>';
  }
  body.styles.align = 'left';
  const bodyRow = createRow(1);
  bodyRow.columns[0].blocks = [body];
  design.sections[1].rows = [bodyRow];

  design.sections[2].rows = [rowFor(`${shell.id}-footer`, shell.footer)];
  return design;
}

for (const shell of ARCHIVE_SHELLS) {
  STARTER_TEMPLATES.push({
    id: shell.id,
    name: shell.name,
    description: shell.description,
    build: () => buildArchiveShell(shell)
  });
}
