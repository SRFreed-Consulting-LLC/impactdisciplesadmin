import { DockingBarPreviewComponent } from './docking-bar-preview.component';

/**
 * THE DOCKING BAR'S PREVIEW.
 *
 * It draws the bar itself rather than framing the real site, because the bar
 * is fixed to the bottom of the window, can be dismissed, and hides on
 * checkout - so a frame would show an empty strip about as often as it
 * showed the thing being edited.
 *
 * The cost of that choice is that this is a COPY of the site's rendering and
 * copies drift. These specs pin the behaviour a copy can get wrong on its
 * own, without ever looking at the site: which buttons are solid, and what
 * happens when there is nothing to announce.
 */
describe('the docking bar preview', () => {
  const make = (dock: Partial<{ label: string; message: string; note: string; buttons: string[] }>) => {
    const component = new DockingBarPreviewComponent();
    component.dock = { buttons: [], ...dock } as never;
    return component;
  };

  it('says nothing rather than drawing an empty bar', () => {
    // `message` is the one field the real bar cannot render without. An
    // empty bar in the editor reads as a styling fault; a bar with nothing
    // to announce simply does not appear on the site.
    expect(make({}).empty).toBeTrue();
    expect(make({ message: '   ' }).empty)
      .withContext('whitespace is not an announcement')
      .toBeTrue();
    expect(make({ message: 'Join the library' }).empty).toBeFalse();
  });

  it('is not empty merely because it has no buttons', () => {
    // The buttons are optional on the site; the message is not.
    expect(make({ message: 'Join the library' }).empty).toBeFalse();
  });

  it('drops buttons with nothing written on them', () => {
    // The editor always has two button groups, and the second is usually
    // blank. Drawing it would put an empty white rectangle on the bar.
    expect(make({ message: 'x', buttons: ['Join', ''] }).buttons).toEqual(['Join']);
    expect(make({ message: 'x', buttons: ['', '  '] }).buttons).toEqual([]);
  });

  it('keeps the buttons in order, because the LAST one is the solid one', () => {
    // The site's own rule: the primary ask sits closest to the edge of the
    // bar, so a pair reads secondary-then-primary and a lone button is
    // always solid. Reversing them would quietly swap which is which.
    expect(make({ message: 'x', buttons: ['Read more', 'Join'] }).buttons)
      .toEqual(['Read more', 'Join']);
  });

  it('survives a dock it has not been given yet', () => {
    // The editor's form exists before its document has loaded.
    const component = new DockingBarPreviewComponent();
    component.dock = undefined as never;
    expect(() => component.empty).not.toThrow();
    expect(component.buttons).toEqual([]);
  });
});
