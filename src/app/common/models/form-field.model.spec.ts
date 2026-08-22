import {
  FIELD_TYPE_GROUPS,
  FIELD_TYPE_META,
  FormFieldDef,
  FormFieldType,
  createFieldDef,
  fieldTypesInGroup,
  flattenDataFields,
  formatFieldValue,
  isLayoutFieldType,
  setColumnCount,
  supportsLabelDisplay,
} from '@impact-common/shared/models/domain/form-field.model';

// Pure functions, no DI, nothing rendered.
//
// This model is the whole vocabulary of the Form Builder: what field types
// exist, what a freshly-dropped field starts as, which fields actually
// collect a value, and how a submitted value reads back. Admins author
// forms against it and submissions are stored against it, so a change here
// reaches data that outlives the code.

const field = (over: Partial<FormFieldDef>): FormFieldDef =>
  ({ id: 'f1', type: 'text', label: 'Field', ...over }) as FormFieldDef;

describe('form-field.model', () => {
  describe('FIELD_TYPE_META', () => {
    it('describes every field type with a label, icon and group', () => {
      for (const [type, meta] of Object.entries(FIELD_TYPE_META)) {
        expect(meta.label?.trim()).withContext(`${type} has no label`).toBeTruthy();
        expect(meta.icon?.trim()).withContext(`${type} has no icon`).toBeTruthy();
        expect(FIELD_TYPE_GROUPS).withContext(`${type} has an unknown group`).toContain(meta.group);
        expect(typeof meta.isLayout).withContext(`${type} has no isLayout`).toBe('boolean');
      }
    });

    it('puts every type into exactly one palette group', () => {
      const all = Object.keys(FIELD_TYPE_META) as FormFieldType[];
      const grouped = FIELD_TYPE_GROUPS.flatMap((g) => fieldTypesInGroup(g));
      expect(grouped.length).toBe(all.length);
      expect(new Set(grouped).size).toBe(all.length);
    });
  });

  describe('isLayoutFieldType', () => {
    it('is true for the content-only types', () => {
      expect(isLayoutFieldType('heading')).toBeTrue();
      expect(isLayoutFieldType('divider')).toBeTrue();
    });

    it('is false for types that collect a value', () => {
      expect(isLayoutFieldType('text')).toBeFalse();
      expect(isLayoutFieldType('checkbox')).toBeFalse();
    });

    it('is false rather than throwing for an unknown type', () => {
      expect(isLayoutFieldType('nonsense' as FormFieldType)).toBeFalse();
    });

    it('agrees with FIELD_TYPE_META for every known type', () => {
      for (const type of Object.keys(FIELD_TYPE_META) as FormFieldType[]) {
        expect(isLayoutFieldType(type)).withContext(type).toBe(FIELD_TYPE_META[type].isLayout);
      }
    });
  });

  describe('supportsLabelDisplay', () => {
    it('answers with a boolean for every known type', () => {
      for (const type of Object.keys(FIELD_TYPE_META) as FormFieldType[]) {
        expect(typeof supportsLabelDisplay(type)).withContext(type).toBe('boolean');
      }
    });
  });

  describe('createFieldDef', () => {
    it('takes its label from the type metadata and starts optional', () => {
      const created = createFieldDef('text');
      expect(created.type).toBe('text');
      expect(created.label).toBe(FIELD_TYPE_META['text'].label);
      expect(created.required).toBeFalse();
    });

    it('gives every field its own id', () => {
      expect(createFieldDef('text').id).not.toBe(createFieldDef('text').id);
    });

    it('starts choice fields with two usable placeholder options', () => {
      // A freshly-dropped dropdown with no options is an unusable control.
      for (const type of ['checkboxes', 'radio', 'dropdown'] as FormFieldType[]) {
        const created = createFieldDef(type);
        expect(created.options?.length).withContext(type).toBe(2);
      }
    });

    it('gives each choice field its OWN options, not a shared array', () => {
      const a = createFieldDef('dropdown');
      const b = createFieldDef('dropdown');
      a.options![0].label = 'Edited';
      expect(b.options![0].label).toBe('Option 1');
    });

    it('starts a columns field with two empty columns', () => {
      const created = createFieldDef('columns');
      expect(created.columns?.length).toBe(2);
      expect(created.columns?.every((c) => c.fields.length === 0)).toBeTrue();
    });

    it('seeds the type-specific fields for instructions and image', () => {
      expect(createFieldDef('instructions').html).toBe('');
      const image = createFieldDef('image');
      expect(image.imageUrl).toBe('');
      expect(image.imageWidth).toBe('medium');
    });

    it('adds no options to a plain text field', () => {
      expect(createFieldDef('text').options).toBeUndefined();
    });
  });

  describe('setColumnCount', () => {
    const columns = (counts: number[]): FormFieldDef =>
      field({
        type: 'columns',
        columns: counts.map((n, ci) => ({
          fields: Array.from({ length: n }, (_, fi) => field({ id: `c${ci}f${fi}` })),
        })),
      } as Partial<FormFieldDef>);

    it('does nothing when the count already matches', () => {
      const target = columns([1, 1]);
      const before = JSON.stringify(target.columns);
      setColumnCount(target, 2);
      expect(JSON.stringify(target.columns)).toBe(before);
    });

    it('grows by appending empty columns, leaving existing content alone', () => {
      const target = columns([2, 1]);
      setColumnCount(target, 4);
      expect(target.columns!.length).toBe(4);
      expect(target.columns![0].fields.length).toBe(2);
      expect(target.columns![2].fields.length).toBe(0);
    });

    it('shrinking never discards a field - overflow merges onto the last column', () => {
      // Changing your mind about column count must not silently delete an
      // admin's work.
      const target = columns([1, 1, 2]);
      setColumnCount(target, 2);
      expect(target.columns!.length).toBe(2);
      const kept = target.columns!.flatMap((c) => c.fields.map((f) => f.id));
      expect(kept.length).toBe(4);
      expect(kept).toContain('c2f0');
      expect(kept).toContain('c2f1');
    });

    it('shrinking to one column collects everything into it', () => {
      const target = columns([1, 1, 1]);
      setColumnCount(target, 1);
      expect(target.columns!.length).toBe(1);
      expect(target.columns![0].fields.length).toBe(3);
    });

    it('handles a columns field that has no columns yet', () => {
      const target = field({ type: 'columns' });
      setColumnCount(target, 3);
      expect(target.columns!.length).toBe(3);
    });
  });

  describe('flattenDataFields', () => {
    it('keeps only the fields that collect a value', () => {
      const flat = flattenDataFields([
        field({ id: 'h', type: 'heading' }),
        field({ id: 'name' }),
        field({ id: 'rule', type: 'divider' }),
      ]);
      expect(flat.map((f) => f.id)).toEqual(['name']);
    });

    it('recurses into every column, and drops the container itself', () => {
      const flat = flattenDataFields([
        field({
          id: 'row',
          type: 'columns',
          columns: [
            { fields: [field({ id: 'left' })] },
            { fields: [field({ id: 'right' }), field({ id: 'h2', type: 'heading' })] },
          ],
        } as Partial<FormFieldDef>),
      ]);
      expect(flat.map((f) => f.id)).toEqual(['left', 'right']);
    });

    it('recurses through nested columns', () => {
      const flat = flattenDataFields([
        field({
          id: 'outer',
          type: 'columns',
          columns: [{
            fields: [field({
              id: 'inner',
              type: 'columns',
              columns: [{ fields: [field({ id: 'deep' })] }],
            } as Partial<FormFieldDef>)],
          }],
        } as Partial<FormFieldDef>),
      ]);
      expect(flat.map((f) => f.id)).toEqual(['deep']);
    });

    it('returns nothing for an empty or layout-only form', () => {
      expect(flattenDataFields([])).toEqual([]);
      expect(flattenDataFields([field({ type: 'divider' })])).toEqual([]);
    });
  });

  describe('formatFieldValue', () => {
    it('renders an em dash for anything empty', () => {
      expect(formatFieldValue('text', null)).toBe('—');
      expect(formatFieldValue('text', undefined)).toBe('—');
      expect(formatFieldValue('text', '')).toBe('—');
      expect(formatFieldValue('checkboxes', [])).toBe('—');
    });

    it('renders a checkbox as Yes or No, not true or false', () => {
      expect(formatFieldValue('checkbox', true)).toBe('Yes');
      // `false` deliberately reads as "No" rather than the em dash the
      // empty guard gives everything else: an unticked box is an ANSWER,
      // not a blank. The guard only catches null/undefined/'' so false
      // reaches the checkbox branch.
      expect(formatFieldValue('checkbox', false)).toBe('No');
    });

    it('joins checkbox groups with commas', () => {
      expect(formatFieldValue('checkboxes', ['A', 'B'])).toBe('A, B');
    });

    it('renders a rating out of five', () => {
      expect(formatFieldValue('rating', 4)).toBe('4 / 5');
    });

    it('renders an address as one line, skipping the parts that are absent', () => {
      const full = formatFieldValue('address', {
        address1: '1 Main St', address2: 'Apt 2', city: 'Austin', state: 'TX', zip: '78701',
      });
      expect(full).toBe('1 Main St, Apt 2, Austin, TX, 78701');

      const sparse = formatFieldValue('address', { address1: '1 Main St', city: 'Austin' });
      expect(sparse).toBe('1 Main St, Austin');
    });

    it('renders a phone with its country code and type when present', () => {
      expect(formatFieldValue('phone', { countryCode: '+1', number: '555-1234', type: 'Mobile' }))
        .toBe('+1 555-1234 (Mobile)');
      expect(formatFieldValue('phone', { number: '555-1234' })).toBe('555-1234');
    });

    it('renders a date through the locale, not as an ISO string', () => {
      const date = new Date('2026-03-01T12:00:00Z');
      expect(formatFieldValue('date', date)).toBe(date.toLocaleString());
    });

    it('falls back to the string form of anything else', () => {
      expect(formatFieldValue('number', 42)).toBe('42');
      expect(formatFieldValue('text', 'hello')).toBe('hello');
    });
  });
});
