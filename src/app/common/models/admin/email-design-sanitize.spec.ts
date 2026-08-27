import { createDesignFromFullHtml, HtmlBlock } from './email-design.model';

// Regression cover for the 2026-08-27 sweep finding S1.
//
// createDesignFromFullHtml stripped `<script>` with a regex and called it
// done, then stored the result as an html block. The designer canvas renders
// that through bypassSecurityTrustHtml in a plain <div>, so every non-<script>
// vector executed same-origin with the viewing admin's Firebase session - and
// the import path is reachable by any staff account that can write
// campaign_emails, which an Admin then opens under "start from a past email".
//
// These assert the vectors the old regex let through, not the one it caught.

/** The html of the single block createDesignFromFullHtml produces. */
function importedHtml(source: string): string {
  const design = createDesignFromFullHtml(source);
  const block = design.sections[1].rows[0].columns[0].blocks[0] as HtmlBlock;
  return block.props.html;
}

describe('createDesignFromFullHtml sanitization', () => {
  it('drops an onerror handler the old <script> regex sailed past', () => {
    const html = importedHtml('<body><img src=x onerror="alert(1)"></body>');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('alert(1)');
  });

  it('drops onload on an svg', () => {
    const html = importedHtml('<body><svg onload="alert(1)"></svg></body>');
    expect(html).not.toContain('onload');
  });

  it('still removes script elements', () => {
    const html = importedHtml('<body><p>hi</p><script>alert(1)</script></body>');
    expect(html.toLowerCase()).not.toContain('<script');
    expect(html).toContain('hi');
  });

  it('drops a javascript: href', () => {
    const html = importedHtml('<body><a href="javascript:alert(1)">x</a></body>');
    expect(html).not.toContain('javascript:');
  });

  it('drops an iframe', () => {
    const html = importedHtml('<body><iframe src="https://evil.test"></iframe></body>');
    expect(html.toLowerCase()).not.toContain('<iframe');
  });

  it('KEEPS the inline styles and table markup mined email chrome needs', () => {
    // The whole reason this is DOMPurify and not an escape: the archive
    // shells are deeply nested tables carrying their own inline styles, and
    // the point of reusing them is that they survive real inboxes.
    const source =
      '<body><table role="presentation" width="100%">' +
      '<tbody><tr><td style="background-color:#FFFFFF" align="center">' +
      '<img src="https://firebasestorage.googleapis.com/logo.png" alt="Logo">' +
      '</td></tr></tbody></table></body>';
    const html = importedHtml(source);

    expect(html).toContain('<table');
    expect(html).toContain('background-color:#FFFFFF');
    expect(html).toContain('align="center"');
    expect(html).toContain('<img');
    expect(html).toContain('alt="Logo"');
  });

  it('keeps a <style> block hoisted out of the document head', () => {
    // Extracted head styles are how a mined campaign keeps its media queries.
    const html = importedHtml(
      '<html><head><style>.mceRow{padding:0}</style></head><body><p>x</p></body></html>'
    );
    expect(html).toContain('.mceRow');
  });

  it('keeps the Outlook conditional comments email chrome is built on', () => {
    // Non-negotiable for this codebase: every mined archive shell carries
    // balanced <!--[if mso]> ... <![endif]--> pairs, and an unbalanced
    // conditional can make Outlook swallow the rest of the document. The
    // chrome cleanup script explicitly preserves these; the sanitizer must
    // not undo that.
    const html = importedHtml(
      '<body><!--[if mso]><table><tr><td><![endif]--><p>x</p>' +
      '<!--[if mso]></td></tr></table><![endif]--></body>'
    );
    expect(html).toContain('[if mso]');
    expect(html).toContain('[endif]');
  });

  it('preserves <style> CONTENT verbatim - the documented residual', () => {
    // Measured on DOMPurify 3.4.13: it allows the element through with
    // FORCE_BODY but does not rewrite the CSS inside it. This asserts the
    // real boundary rather than a protection that does not exist.
    //
    // Accepted because the alternative is dropping <style> entirely, which
    // deletes the media queries every imported campaign renders its mobile
    // layout with. The classic CSS vector, IE's expression(), does not
    // execute in any browser this admin app runs in.
    const html = importedHtml(
      '<body><style>.x{width:expression(alert(1))}</style><p>y</p></body>'
    );
    expect(html).toContain('<style>');
    expect(html).toContain('.x{');
  });

  it('round-trips a real archive shell without losing its structure', () => {
    // The actual thing this has to not break: mined Mailchimp chrome, which
    // is nested tables + inline styles + balanced mso conditionals.
    const shell =
      '<body><table role="presentation" width="100%"><tbody><tr>' +
      '<td style="background-color:#FFFFFF" valign="top" align="center">' +
      '<!--[if (gte mso 9)|(IE)]><table align="center" width="660"><tr><td><![endif]-->' +
      '<img src="https://firebasestorage.googleapis.com/logo.png" width="200" alt="Impact">' +
      '<!--[if (gte mso 9)|(IE)]></td></tr></table><![endif]-->' +
      '</td></tr></tbody></table></body>';
    const html = importedHtml(shell);

    expect(html).toContain('role="presentation"');
    expect(html).toContain('background-color:#FFFFFF');
    expect(html).toContain('valign="top"');
    expect(html).toContain('<img');
    // Conditionals must come back BALANCED - an unclosed one can make Outlook
    // swallow the rest of the document.
    expect((html.match(/\[if /g) || []).length).toBe(2);
    expect((html.match(/\[endif\]/g) || []).length).toBe(2);
  });
});
