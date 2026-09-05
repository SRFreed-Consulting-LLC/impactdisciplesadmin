import { SpacerBlock } from 'src/app/common/models/admin/email-design.model';
import { SpacerBlockSettingsComponent } from './spacer-block-settings.component';

// Moved here from designer-side-panel.component.spec.ts on 2026-09-05 with
// the code it covers (review item 3, block editors).

describe('SpacerBlockSettingsComponent', () => {
  it('height clamps to 4..200 and falls back to 24', () => {
    const state = { commit: (mutate: () => void) => mutate() };
    const component = new SpacerBlockSettingsComponent(state as never);
    component.block = { type: 'spacer', props: { height: 24 } } as SpacerBlock;
    component.setHeight(500)();
    expect(component.block.props.height).toBe(200);
    component.setHeight(1)();
    expect(component.block.props.height).toBe(4);
    component.setHeight('abc')();
    expect(component.block.props.height).toBe(24);
  });
});
