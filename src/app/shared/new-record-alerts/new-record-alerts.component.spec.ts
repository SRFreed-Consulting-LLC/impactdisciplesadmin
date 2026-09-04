import { visibleAlertSources } from './new-record-alerts.component';

// The bell announces new purchases, form submissions and registrations.
// Since 2026-09-03 an entry shows only to someone who could open the
// screen those records live on - otherwise an Employee granted a single
// page was told "3 new purchases" every morning. Pinned on the pure gate
// rather than the component: the component takes six data services whose
// only job here would be to be stubbed.
describe('NewRecordAlertsComponent - visibleAlertSources', () => {
  it('shows every source to someone who can see every screen', () => {
    expect(visibleAlertSources(() => true).map((s) => s.key)).toEqual([
      'eventRegistrations', 'formSubmissions', 'purchases'
    ]);
  });

  it('shows nothing to someone granted none of the three screens', () => {
    expect(visibleAlertSources(() => false)).toEqual([]);
  });

  it('shows exactly the sources whose screen is granted, by the real keys', () => {
    const granted = new Set(['contacts-manager.fulfillment']);
    const sources = visibleAlertSources((key) => granted.has(key));
    expect(sources.map((s) => s.key)).toEqual(['purchases']);
  });

  it('keys each source to a real screen', () => {
    // A typo here hides an alert from everyone but Admin, silently.
    expect(visibleAlertSources(() => true).map((s) => s.screenKey)).toEqual([
      'events-manager.events', 'data.custom-form-submissions', 'contacts-manager.fulfillment'
    ]);
  });
});
