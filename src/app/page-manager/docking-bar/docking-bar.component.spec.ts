import { FormBuilder } from '@angular/forms';
import { DockBarModel } from '@impact-common/shared/models/domain/dock-bar.model';
import { DockingBarComponent } from './docking-bar.component';

// What this screen writes is what the public site renders, so the shape of
// the saved document is the thing worth pinning. Three rules matter and are
// each easy to break by accident:
//
//  - optional fields are OMITTED when blank, never written as ''. Firestore
//    rejects `undefined` outright, and an empty string would defeat the
//    renderer's "did staff fill this in?" checks;
//  - the second button exists only once it has a title - a blank title means
//    a one-button bar, not a button with no label;
//  - a URL is only kept alongside the 'external' sentinel, so switching a
//    button back to an internal page cannot leave a stale address behind.
//
// Hand-constructed with duck-typed deps - house style, and this component
// takes everything through its constructor.

describe('DockingBarComponent', () => {
  let saved: DockBarModel[];
  let stored: DockBarModel | undefined;
  let snackbar: { success: jasmine.Spy; error: jasmine.Spy };
  let component: DockingBarComponent;
  let canEdit: boolean;

  function build(): DockingBarComponent {
    saved = [];
    canEdit = true;
    snackbar = { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') };

    return new DockingBarComponent(
      {
        get: () => Promise.resolve(stored),
        save: (config: DockBarModel) => {
          saved.push(config);
          return Promise.resolve();
        }
      } as never,
      { canEdit: () => canEdit } as never,
      new FormBuilder(),
      snackbar as never
    );
  }

  beforeEach(() => {
    stored = undefined;
    component = build();
  });

  function fill(overrides: Record<string, unknown> = {}): void {
    component.form.patchValue({
      isActive: true,
      label: 'New',
      message: 'The Impact Discipleship Library',
      note: '· free to join',
      cta1: { title: 'See what it does', destination: '/discipleship-library', url: '' },
      cta2: { title: '', destination: '', url: '' },
      ...overrides
    });
  }

  describe('the destination dropdown', () => {
    it('offers the Library pages the bar itself points at', () => {
      const values = component.destinations.map((d) => d.value);
      expect(values).toContain('/discipleship-library');
      expect(values).toContain('/impact-groups');
    });

    it('keeps the External escape hatch last', () => {
      expect(component.destinations[component.destinations.length - 1].value).toBe('external');
    });

    it('flattens dropdown groups rather than listing unlinkable parents', () => {
      // 'Training' is a dropdown parent with no link of its own - its
      // children must be offered, it must not be.
      expect(component.destinations.some((d) => d.text === 'Training')).toBe(false);
      expect(component.destinations.some((d) => d.value === '/seminars')).toBe(true);
    });
  });

  describe('loading', () => {
    it('leaves the form at its defaults when nothing has been saved yet', async () => {
      await component.ngOnInit();
      expect(component.form.value.isActive).toBe(false);
      expect(component.form.value.message).toBe('');
      expect(component.spinnerVisible).toBe(false);
    });

    it('fills every field back in from a saved document', async () => {
      stored = {
        isActive: true,
        label: 'New',
        message: 'The Impact Discipleship Library',
        note: '· free to join',
        cta1: { title: 'See what it does', destination: '/discipleship-library' },
        cta2: { title: 'Join a Group', destination: '/impact-groups' }
      } as DockBarModel;

      await component.ngOnInit();

      expect(component.form.value.label).toBe('New');
      expect(component.form.value.cta2.title).toBe('Join a Group');
      expect(component.hasSecondCta).toBe(true);
    });
  });

  describe('saving', () => {
    it('writes the whole bar, trimmed', async () => {
      fill({
        message: '  The Impact Discipleship Library  ',
        cta2: { title: 'Join a Group', destination: '/impact-groups', url: '' }
      });

      await component.save();

      expect(saved.length).toBe(1);
      expect(saved[0]).toEqual({
        isActive: true,
        message: 'The Impact Discipleship Library',
        label: 'New',
        note: '· free to join',
        cta1: { title: 'See what it does', destination: '/discipleship-library' },
        cta2: { title: 'Join a Group', destination: '/impact-groups' }
      } as DockBarModel);
      expect(snackbar.success).toHaveBeenCalled();
    });

    it('omits blank optional fields instead of writing empty strings', async () => {
      fill({ label: '   ', note: '' });

      await component.save();

      expect('label' in saved[0]).toBe(false);
      expect('note' in saved[0]).toBe(false);
    });

    it('omits the second button entirely when it has no title', async () => {
      fill({ cta2: { title: '  ', destination: '/impact-groups', url: '' } });

      await component.save();

      expect('cta2' in saved[0]).toBe(false);
    });

    it('keeps a URL only alongside the external sentinel', async () => {
      fill({ cta1: { title: 'Merch', destination: 'external', url: 'https://example.com' } });
      await component.save();
      expect(saved[0].cta1.url).toBe('https://example.com');

      component = build();
      fill({ cta1: { title: 'Store', destination: '/store', url: 'https://stale.example.com' } });
      await component.save();
      expect('url' in saved[0].cta1).toBe(false);
    });

    it('refuses to save a bar with no message', async () => {
      fill({ message: '' });

      await component.save();

      expect(saved.length).toBe(0);
      expect(snackbar.error).toHaveBeenCalled();
    });

    it('refuses to save at all without edit permission', async () => {
      fill();
      canEdit = false;

      await component.save();

      expect(saved.length).toBe(0);
    });

    it('reports a failed write and stops the spinner', async () => {
      component = build();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (component as any).service = { save: () => Promise.reject(new Error('offline')) };
      fill();

      await component.save();

      expect(snackbar.error).toHaveBeenCalled();
      expect(component.spinnerVisible).toBe(false);
    });
  });
});
