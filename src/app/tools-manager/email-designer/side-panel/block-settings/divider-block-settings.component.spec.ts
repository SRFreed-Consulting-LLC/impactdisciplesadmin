import { DividerBlock } from 'src/app/common/models/admin/email-design.model';
import { DividerBlockSettingsComponent } from './divider-block-settings.component';

// The thickness test moved here from designer-side-panel.component.spec.ts
// on 2026-09-05 with the code it covers (review item 3, block editors); the
// style/colour null cases are new.

function makeComponent() {
  const state = { commit: (mutate: () => void) => mutate() };
  const component = new DividerBlockSettingsComponent(state as never);
  component.block = { type: 'divider', props: { style: null, thickness: null, color: null } } as DividerBlock;
  return component;
}

describe('DividerBlockSettingsComponent', () => {
  it('thickness clamps to 1..12 but keeps an explicit null', () => {
    const component = makeComponent();
    component.setThickness(99)();
    expect(component.block.props.thickness).toBe(12);
    // null means "no override", and must survive rather than clamp to 1.
    component.setThickness(null)();
    expect(component.block.props.thickness).toBeNull();
    component.setThickness('')();
    expect(component.block.props.thickness).toBeNull();
  });

  it('an empty style or colour means inherit, stored as null', () => {
    const component = makeComponent();
    component.setStyle('dashed')();
    expect(component.block.props.style).toBe('dashed');
    component.setStyle('')();
    expect(component.block.props.style).toBeNull();
    component.setColor('#abcdef')();
    expect(component.block.props.color).toBe('#abcdef');
    component.setColor(null)();
    expect(component.block.props.color).toBeNull();
  });
});
