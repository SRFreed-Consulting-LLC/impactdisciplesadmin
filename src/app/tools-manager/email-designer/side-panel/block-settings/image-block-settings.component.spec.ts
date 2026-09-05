import { ImageBlock } from 'src/app/common/models/admin/email-design.model';
import { ImageBlockSettingsComponent } from './image-block-settings.component';

// Moved here from designer-side-panel.component.spec.ts on 2026-09-05 with
// the code they cover (review item 3, block editors): the scale clamp, the
// href normalisation, and the picker's write-through. The "two targets"
// tests did not move - there is one target now, this block - and the
// leak test became "closing twice writes once".

function makeComponent(props: Partial<ImageBlock['props']> = {}) {
  const commits: number[] = [];
  const state = { commit: (mutate: () => void) => { commits.push(1); mutate(); } };
  const component = new ImageBlockSettingsComponent(state as never);
  component.block = { type: 'image', props: { src: null, alt: '', href: null, openInNewTab: false, sizing: 'original', scalePercent: 100, naturalWidth: null, ...props } } as unknown as ImageBlock;
  return { component, commits };
}

describe('ImageBlockSettingsComponent', () => {
  it('image scale clamps to 10..100 and falls back to 100', () => {
    const { component } = makeComponent();
    component.setScale(400)();
    expect(component.props.scalePercent).toBe(100);
    component.setScale(2)();
    expect(component.props.scalePercent).toBe(10);
    component.setScale('')();
    expect(component.props.scalePercent).toBe(100);
  });

  it('an empty href becomes null, not an empty string', () => {
    const { component } = makeComponent();
    component.setHref('   ')();
    expect(component.props.href).toBeNull();
    component.setHref('  https://x.test  ')();
    expect(component.props.href).toBe('https://x.test');
  });

  describe('picker', () => {
    it('writes a picked image onto the block and back-fills alt', () => {
      const { component, commits } = makeComponent({ naturalWidth: 200 } as never);
      component.openPicker();
      expect(component.pickerVisible$.value).toBeTrue();
      component.pickerCard = { image: { url: 'https://x.test/p.png', name: 'p.png' } as never };
      component.onPickerClosed();
      expect(component.pickerVisible$.value).toBeFalse();
      expect(component.props.src).toBe('https://x.test/p.png');
      expect(component.props.alt).toBe('p.png');
      // Cleared so the compiler re-measures rather than reusing the old size.
      expect(component.props.naturalWidth).toBeNull();
      expect(commits.length).toBe(1);
    });

    it('does NOT overwrite an alt the author already wrote', () => {
      const { component } = makeComponent({ alt: 'Existing alt' });
      component.openPicker();
      component.pickerCard = { image: { url: 'https://x.test/p.png', name: 'p.png' } as never };
      component.onPickerClosed();
      expect(component.props.alt).toBe('Existing alt');
    });

    it('does nothing when the picker closes with no image', () => {
      const { component, commits } = makeComponent({ src: 'unchanged' });
      component.openPicker();
      component.pickerCard = {};
      component.onPickerClosed();
      expect(component.props.src).toBe('unchanged');
      expect(commits.length).toBe(0);
    });

    it('starts each pick from an empty card, so a stale pick cannot carry over', () => {
      const { component } = makeComponent();
      component.pickerCard = { image: { url: 'https://x.test/stale.png' } as never };
      component.openPicker();
      expect(component.pickerCard).toEqual({});
    });
  });
});
