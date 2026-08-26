import { MERGE_TAGS, renderMergeTags, sampleMergeContext, mergeTokenForLabel } from './merge-tags';

describe('renderMergeTags', () => {
  it('replaces every occurrence of a tag, not just the first', () => {
    const html = '<p>Hi *|FNAME|*, welcome *|FNAME|*!</p>';
    expect(renderMergeTags(html, { firstName: 'Alex' })).toBe('<p>Hi Alex, welcome Alex!</p>');
  });

  it('substitutes multiple different tags in one pass', () => {
    const html = '*|FNAME|* *|LNAME|* <*|EMAIL|*>';
    const result = renderMergeTags(html, {
      firstName: 'Alex',
      lastName: 'Rivera',
      email: 'alex@example.com'
    });
    expect(result).toBe('Alex Rivera <alex@example.com>');
  });

  it('falls back to the registered default when the context has no value', () => {
    // UNSUB's registered default is '#'
    expect(renderMergeTags('<a href="*|UNSUB|*">bye</a>', {})).toBe('<a href="#">bye</a>');
  });

  it('honors the inline-fallback form *|TAG|fallback|*', () => {
    expect(renderMergeTags('Hi *|FNAME|friend|*!', {})).toBe('Hi friend!');
    expect(renderMergeTags('Hi *|FNAME|friend|*!', { firstName: 'Alex' })).toBe('Hi Alex!');
  });

  it('absorbs legacy {{Human Readable}} tokens (all occurrences)', () => {
    const html = '{{Recipient First Name}} and again {{Recipient First Name}}';
    expect(renderMergeTags(html, { firstName: 'Alex' })).toBe('Alex and again Alex');
  });

  it('absorbs legacy {{camelCase}} tokens used by the Cloud Functions', () => {
    expect(renderMergeTags('Hi {{firstName}} {{lastName}}', { firstName: 'A', lastName: 'B' })).toBe(
      'Hi A B'
    );
  });

  it('resolves *|UNSUB|* to the caller-supplied unsubscribe URL', () => {
    const url = 'https://example.com/unsub?email=a%40b.com';
    expect(renderMergeTags('<a href="*|UNSUB|*">Unsubscribe</a>', { unsubscribeUrl: url })).toBe(
      `<a href="${url}">Unsubscribe</a>`
    );
  });

  it('leaves unregistered tags untouched', () => {
    expect(renderMergeTags('Keep *|MYSTERY|* as-is', { firstName: 'Alex' })).toBe(
      'Keep *|MYSTERY|* as-is'
    );
  });

  it('tolerates null/empty input', () => {
    expect(renderMergeTags('', { firstName: 'Alex' })).toBe('');
    expect(renderMergeTags(null as unknown as string, {})).toBe('');
  });
});

describe('sampleMergeContext', () => {
  it('provides a sample value for every registered tag', () => {
    const context = sampleMergeContext();
    for (const def of MERGE_TAGS) {
      expect(context[def.resolverKey]).withContext(def.tag).toBeTruthy();
    }
  });
});

// The 2026-08-24 live bug: a token inserted through the editor renders
// verbatim in the email. Quill 2's getSemanticHTML() encodes every space
// as &nbsp;, so the stored html carried {{Recipient&nbsp;First&nbsp;Name}}
// and the exact-literal legacy match never fired. Nothing tested the
// EDITOR'S OWN output shape, only hand-written tokens, so it passed.
describe('renderMergeTags with editor-mangled spaces', () => {
  it('substitutes a legacy token whose spaces became &nbsp;', () => {
    const html = '<p>{{Recipient&nbsp;First&nbsp;Name}},</p>';

    expect(renderMergeTags(html, { firstName: 'Shane' })).toBe('<p>Shane,</p>');
  });

  it('substitutes one whose spaces became real non-breaking characters', () => {
    const html = '<p>{{Recipient First Name}}</p>';

    expect(renderMergeTags(html, { firstName: 'Shane' })).toBe('<p>Shane</p>');
  });

  it('still substitutes the plain-spaced spelling', () => {
    const html = '<p>{{Recipient First Name}}</p>';

    expect(renderMergeTags(html, { firstName: 'Shane' })).toBe('<p>Shane</p>');
  });

  it('leaves an unregistered token alone however it is spaced', () => {
    const html = '<p>{{Not&nbsp;A&nbsp;Tag}}</p>';

    expect(renderMergeTags(html, { firstName: 'Shane' })).toBe(html);
  });
});

describe('mergeTokenForLabel', () => {
  it('gives the picker the modern spelling, which has no spaces to mangle', () => {
    expect(mergeTokenForLabel('Recipient First Name')).toBe('*|FNAME|*');
    expect(mergeTokenForLabel('Sender Last Name')).toBe('*|SENDER_LNAME|*');
  });

  it('falls back to the legacy spelling for an unregistered label', () => {
    expect(mergeTokenForLabel('Something Else')).toBe('{{Something Else}}');
  });
});
