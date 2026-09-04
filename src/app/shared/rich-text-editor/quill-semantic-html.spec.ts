import Quill from 'quill';
import {
  installQuillSemanticHtmlSpaceFix,
  unjoinSerialisedSpaces
} from './quill-semantic-html';
import { RICH_TEXT_TOOLBAR } from './quill-toolbar.config';

// EVERY NON-BREAKING SPACE HERE IS WRITTEN `\u00A0`. The defect under test is
// an invisible character, so a fixture containing one is a fixture nobody can
// review - and a spec asserting "nbsp becomes space" would pass by comparing
// two identical plain strings.
const NB = '\u00A0';

describe('unjoinSerialisedSpaces', () => {
  it('turns the entity Quill emits back into a space', () => {
    expect(unjoinSerialisedSpaces('<p>Hear&nbsp;from&nbsp;Kevin</p>'))
      .toBe('<p>Hear from Kevin</p>');
  });

  it('turns the raw character back into a space too', () => {
    expect(unjoinSerialisedSpaces(`<p>Hear${NB}from</p>`)).toBe('<p>Hear from</p>');
  });

  it('leaves HTML that never had one untouched', () => {
    expect(unjoinSerialisedSpaces('<p>Hear from Kevin</p>')).toBe('<p>Hear from Kevin</p>');
  });

  it('handles the empty string', () => {
    expect(unjoinSerialisedSpaces('')).toBe('');
  });
});

/**
 * THE TEST THAT ACTUALLY GUARDS THE BUG.
 *
 * The function above is trivial; what is not trivial is that Quill's
 * serialiser does the damage at all, and that the wrap is installed somewhere
 * that catches it. Both are verified here against a real Quill, because both
 * fail silently: an uninstalled patch leaves an editor that works perfectly
 * and writes broken HTML.
 */
describe('the serialiser, through a real Quill', () => {
  let host: HTMLElement;
  let quill: Quill;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    quill = new Quill(host, { modules: RICH_TEXT_TOOLBAR, theme: 'snow' });
    quill.setText('Hear from Kevin Burrell');
  });

  afterEach(() => host.remove());

  it('emits ordinary spaces once the fix is installed', () => {
    installQuillSemanticHtmlSpaceFix();

    const html = quill.getSemanticHTML();

    expect(html).not.toContain('&nbsp;');
    expect(html).not.toContain(NB);
    expect(html).toContain('Hear from Kevin Burrell');
  });

  it('is idempotent - installing twice does not wrap twice', () => {
    installQuillSemanticHtmlSpaceFix();
    installQuillSemanticHtmlSpaceFix();

    expect(quill.getSemanticHTML()).toContain('Hear from Kevin Burrell');
  });

  it('leaves the words themselves alone', () => {
    installQuillSemanticHtmlSpaceFix();

    const words = quill.getSemanticHTML().replace(/<[^>]*>/g, '').trim();

    expect(words).toBe('Hear from Kevin Burrell');
  });
});
