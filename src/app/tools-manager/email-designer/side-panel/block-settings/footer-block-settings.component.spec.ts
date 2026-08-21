import { FooterBlock } from 'src/app/common/models/admin/email-design.model';
import { FooterBlockSettingsComponent } from './footer-block-settings.component';

// Moved here from designer-side-panel.component.spec.ts on 2026-08-21 with
// the code they cover, when the footer editor was extracted out of that
// panel (bucket A item #5). Written BEFORE the extraction and passing here
// unchanged.
//
// The address round trip is the reason this component exists as a unit:
// authors type PLAIN TEXT, it is STORED as HTML, and it has to read back as
// the same plain text - including characters that mean something in markup.

function makeComponent() {
  const commits: number[] = [];
  const state = {
    commit: (mutate: () => void) => { commits.push(1); mutate(); },
  };
  const component = new FooterBlockSettingsComponent(state as never);
  component.block = { props: {} } as unknown as FooterBlock;
  return { component, commits };
}

describe('FooterBlockSettingsComponent', () => {
  describe('address round trip', () => {
    it('escapes markup characters on the way in', () => {
      const { component } = makeComponent();
      component.setAddress('Smith & Sons <HQ>')();
      const html = component.block.props.addressHtml;
      expect(html).not.toContain('<HQ>');
      expect(html).toContain('&amp;');
      expect(html).toContain('&lt;HQ&gt;');
    });

    it('turns newlines into <br> and reads them back as newlines', () => {
      const { component } = makeComponent();
      component.setAddress('Line one\nLine two')();
      expect(component.block.props.addressHtml).toContain('<br>');
      expect(component.addressText()).toBe('Line one\nLine two');
    });

    it('round-trips escaped characters back to their plain form', () => {
      const { component } = makeComponent();
      component.setAddress('Smith & Sons <HQ>')();
      expect(component.addressText()).toBe('Smith & Sons <HQ>');
    });

    it('stores empty for blank input, and reads back empty', () => {
      const { component } = makeComponent();
      component.setAddress('   ')();
      expect(component.block.props.addressHtml).toBe('');
      expect(component.addressText()).toBe('');
    });

    it('reads back empty when nothing was ever stored', () => {
      const { component } = makeComponent();
      expect(component.addressText()).toBe('');
    });
  });

  describe('unsubscribe', () => {
    it('falls back to "Unsubscribe" for a blank label', () => {
      const { component } = makeComponent();
      component.setUnsubscribeLabel('   ')();
      expect(component.block.props.unsubscribeLabel).toBe('Unsubscribe');
    });

    it('trims a supplied label', () => {
      const { component } = makeComponent();
      component.setUnsubscribeLabel('  Opt out  ')();
      expect(component.block.props.unsubscribeLabel).toBe('Opt out');
    });

    it('toggles inclusion', () => {
      const { component } = makeComponent();
      component.setUnsubscribe(false)();
      expect(component.block.props.includeUnsubscribe).toBeFalse();
      component.setUnsubscribe(true)();
      expect(component.block.props.includeUnsubscribe).toBeTrue();
    });
  });

  describe('permission reminder', () => {
    it('stores the text verbatim', () => {
      const { component } = makeComponent();
      component.setReminder('You signed up at a conference.')();
      expect(component.block.props.permissionReminder).toBe('You signed up at a conference.');
    });
  });

  describe('commit', () => {
    it('runs a composed mutator through the state service, one undo step', () => {
      const { component, commits } = makeComponent();
      component.commit(component.setReminder('Hi'));
      expect(commits.length).toBe(1);
      expect(component.block.props.permissionReminder).toBe('Hi');
    });
  });
});
