import { HtmlBlock } from 'src/app/common/models/admin/email-design.model';
import { HtmlBlockSettingsComponent } from './html-block-settings.component';

// Moved here from designer-side-panel.component.spec.ts on 2026-09-05 with
// the code they cover (review item 3, block editors). Written before the
// extraction, against the same logic in its old home, passing unchanged.

function makeComponent() {
  const state = { commit: (mutate: () => void) => mutate() };
  const component = new HtmlBlockSettingsComponent(state as never);
  component.block = { type: 'html', props: { html: '' } } as HtmlBlock;
  return component;
}

describe('HtmlBlockSettingsComponent', () => {
  it('sanitizes author markup at EDIT time, keeping layout markup', () => {
    const component = makeComponent();
    component.setHtml('<div class="x">Hi</div><script>alert(1)</script>')();
    expect(component.block.props.html).toContain('<div');
    expect(component.block.props.html).toContain('Hi');
    expect(component.block.props.html.toLowerCase()).not.toContain('<script');
  });

  it('strips inline event handlers', () => {
    const component = makeComponent();
    component.setHtml('<div onclick="steal()">Hi</div>')();
    expect(component.block.props.html.toLowerCase()).not.toContain('onclick');
  });

  it('treats null/undefined as empty rather than throwing', () => {
    const component = makeComponent();
    component.setHtml(null as never)();
    expect(component.block.props.html).toBe('');
  });
});
