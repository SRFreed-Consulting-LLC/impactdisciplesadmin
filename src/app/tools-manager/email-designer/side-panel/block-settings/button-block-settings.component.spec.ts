import { ButtonBlock } from 'src/app/common/models/admin/email-design.model';
import { ButtonBlockSettingsComponent } from './button-block-settings.component';

// New with the extraction (2026-09-05, review item 3). The panel spec never
// covered these one-line setters; the one thing worth pinning is that
// "Use defaults" clears BOTH colours in ONE undo step - it used to be two
// commits from the template, so a single undo brought back only one.

function makeComponent() {
  const commits: number[] = [];
  const state = { commit: (mutate: () => void) => { commits.push(1); mutate(); } };
  const component = new ButtonBlockSettingsComponent(state as never);
  component.block = { type: 'button', props: { label: 'Go', href: '', fullWidth: false, backgroundColor: '#111111', color: '#eeeeee' } } as ButtonBlock;
  return { component, commits };
}

describe('ButtonBlockSettingsComponent', () => {
  it('writes label, link, width and colour overrides through commit', () => {
    const { component, commits } = makeComponent();
    component.commit(component.setLabel('Register'));
    component.commit(component.setHref('https://x.test'));
    component.commit(component.setFullWidth(true));
    component.commit(component.setColor('color', '#000000'));
    expect(component.block.props).toEqual(jasmine.objectContaining({
      label: 'Register', href: 'https://x.test', fullWidth: true, color: '#000000'
    }));
    expect(commits.length).toBe(4);
  });

  it('"Use defaults" clears both colours as ONE undo step', () => {
    const { component, commits } = makeComponent();
    component.clearColors();
    expect(component.block.props.backgroundColor).toBeNull();
    expect(component.block.props.color).toBeNull();
    expect(commits.length).toBe(1);
  });
});
