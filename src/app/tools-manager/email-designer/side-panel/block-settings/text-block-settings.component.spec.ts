import { HeadingBlock, TextBlock } from 'src/app/common/models/admin/email-design.model';
import { TextBlockSettingsComponent } from './text-block-settings.component';

// The font tests moved here from designer-side-panel.component.spec.ts on
// 2026-09-05 with the code they cover (review item 3, block editors); the
// level test is new. House style: hand-constructed, a state stub whose
// commit() RUNS the mutator.

function makeComponent(block: Partial<HeadingBlock | TextBlock>) {
  const commits: number[] = [];
  const state = { commit: (mutate: () => void) => { commits.push(1); mutate(); } };
  const component = new TextBlockSettingsComponent(state as never);
  component.block = { props: {}, ...block } as HeadingBlock | TextBlock;
  return { component, commits };
}

describe('TextBlockSettingsComponent', () => {
  it('knows a heading from a text block', () => {
    expect(makeComponent({ type: 'heading' }).component.isHeading).toBeTrue();
    expect(makeComponent({ type: 'text' }).component.isHeading).toBeFalse();
  });

  it('sets a heading level through one commit', () => {
    const { component, commits } = makeComponent({ type: 'heading' });
    component.commit(component.setLevel(3));
    expect((component.block as HeadingBlock).props.level).toBe(3);
    expect(commits.length).toBe(1);
  });

  it('an empty block font becomes null, not an empty string', () => {
    const { component } = makeComponent({ type: 'text' });
    component.setFont('')();
    expect(component.block.props.fontFamily).toBeNull();
    expect(component.font).toBe('');
    component.setFont('Georgia, serif')();
    expect(component.font).toBe('Georgia, serif');
  });

  it('fontLabel shows only the first family in a stack', () => {
    const { component } = makeComponent({ type: 'text' });
    expect(component.fontLabel('Georgia, Times, serif')).toBe('Georgia');
  });
});
