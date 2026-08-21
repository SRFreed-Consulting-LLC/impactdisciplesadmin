import { SocialBlock } from 'src/app/common/models/admin/email-design.model';
import { SocialBlockSettingsComponent } from './social-block-settings.component';

// Moved here from designer-side-panel.component.spec.ts on 2026-08-21 with
// the code they cover, when the social editor was extracted out of that
// panel (bucket A item #5). Written BEFORE the extraction, against the same
// logic in its old home, and passing here unchanged.
//
// House style: hand-constructed, duck-typed deps, no TestBed. The state
// service is stubbed with a real commit() that RUNS the mutator, because
// every assertion is about what the mutator did.

function makeComponent(networkCount = 0) {
  const commits: number[] = [];
  const state = {
    commit: (mutate: () => void) => { commits.push(1); mutate(); },
  };
  const component = new SocialBlockSettingsComponent(state as never);
  component.block = {
    props: {
      networks: Array.from({ length: networkCount }, (_, i) => ({
        network: 'custom', url: '', label: `N${i}`, iconUrl: null,
      })),
    },
  } as unknown as SocialBlock;
  return { component, commits };
}

const labels = (component: SocialBlockSettingsComponent) =>
  component.block.props.networks.map((n) => n.label);

describe('SocialBlockSettingsComponent', () => {
  describe('networks', () => {
    it('appends a preset network', () => {
      const { component } = makeComponent(1);
      component.addNetwork({ network: 'facebook', label: 'Facebook' });
      expect(labels(component)).toEqual(['N0', 'Facebook']);
    });

    it('removes by index', () => {
      const { component } = makeComponent(3);
      component.removeNetwork(1);
      expect(labels(component)).toEqual(['N0', 'N2']);
    });

    it('reorders within bounds', () => {
      const { component } = makeComponent(3);
      component.moveNetwork(0, 1);
      expect(labels(component)).toEqual(['N1', 'N0', 'N2']);
    });

    it('refuses to move past either end, and does not commit', () => {
      const { component, commits } = makeComponent(2);
      component.moveNetwork(0, -1);
      component.moveNetwork(1, 1);
      expect(labels(component)).toEqual(['N0', 'N1']);
      expect(commits.length).toBe(0);
    });

    it('offers a preset per supported network plus a custom link', () => {
      const { component } = makeComponent();
      expect(component.networkPresets.map((p) => p.network)).toContain('custom');
      expect(component.networkPresets.length).toBeGreaterThan(1);
    });
  });

  // Both numeric inputs clamp rather than validate, so bad input is
  // silently rewritten and the bounds are invisible from the template.
  describe('numeric clamps', () => {
    it('icon size clamps to 16..64 and falls back to 32', () => {
      const { component } = makeComponent();
      component.setIconSize(999)();
      expect(component.block.props.iconSize).toBe(64);
      component.setIconSize(1)();
      expect(component.block.props.iconSize).toBe(16);
      component.setIconSize('abc')();
      expect(component.block.props.iconSize).toBe(32);
    });

    it('spacing clamps to 0..40 and falls back to 14', () => {
      const { component } = makeComponent();
      component.setSpacing(999)();
      expect(component.block.props.spacing).toBe(40);
      component.setSpacing(-5)();
      expect(component.block.props.spacing).toBe(0);
      component.setSpacing('')();
      expect(component.block.props.spacing).toBe(14);
    });
  });

  describe('per-network url', () => {
    it('writes through to the right index', () => {
      const { component } = makeComponent(2);
      component.setUrl(1, 'https://x.test/me')();
      expect(component.block.props.networks[1].url).toBe('https://x.test/me');
      expect(component.block.props.networks[0].url).toBe('');
    });
  });

  describe('commit', () => {
    it('runs a composed mutator through the state service, one undo step', () => {
      const { component, commits } = makeComponent(1);
      component.commit(component.setUrl(0, 'https://x.test'));
      expect(commits.length).toBe(1);
      expect(component.block.props.networks[0].url).toBe('https://x.test');
    });
  });
});
