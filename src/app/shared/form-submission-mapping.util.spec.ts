import { FormSubmissionModel } from '@impact-common/shared/models/domain/form-submission.model';
import { FormFieldType } from '@impact-common/shared/models/domain/form-field.model';
import { extractSubmission, submitterIdentity } from './form-submission-mapping.util';

// Builds a submission the way the public form writer does: a fieldSnapshot
// of {id, label, type} plus UUID-keyed values. Field ids here are just
// deterministic strings - the util only ever joins snapshot.id -> values key.
function submission(
  fields: { label: string; type: FormFieldType; value?: unknown }[]
): FormSubmissionModel {
  const model = new FormSubmissionModel();
  model.fieldSnapshot = fields.map((f, i) => ({ id: `field-${i}`, label: f.label, type: f.type }));
  model.values = {};
  fields.forEach((f, i) => {
    if (f.value !== undefined) {
      model.values[`field-${i}`] = f.value;
    }
  });
  return model;
}

const contactUsSubmission = () =>
  submission([
    { label: 'First Name', type: 'text', value: 'Alex' },
    { label: 'Last Name', type: 'text', value: 'Rivera' },
    { label: 'Email', type: 'email', value: 'Alex.Rivera@Example.com' },
    { label: 'Message', type: 'paragraph', value: 'Please contact me about coaching.' }
  ]);

const seminarSubmission = () =>
  submission([
    { label: 'Church Name', type: 'text', value: 'Crossroads Community Church' },
    { label: 'Event Coordinator Name', type: 'text', value: 'Jane Van Dyke' },
    { label: 'Email', type: 'email', value: 'jane@crossroads.org' },
    { label: 'City', type: 'text', value: 'Sharpsburg' },
    { label: 'State', type: 'text', value: 'GA' }
  ]);

describe('extractSubmission', () => {
  describe('a Contact Us-style submission (person only)', () => {
    it('extracts first/last name from dedicated fields and lowercases the email', () => {
      const result = extractSubmission(contactUsSubmission());

      expect(result.firstName).toBe('Alex');
      expect(result.lastName).toBe('Rivera');
      expect(result.email).toBe('alex.rivera@example.com');
      expect(result.hasIdentity).toBeTrue();
    });

    it('has no orgName, so it qualifies for Create Contact only', () => {
      expect(extractSubmission(contactUsSubmission()).orgName).toBeUndefined();
    });
  });

  describe('a Seminar-style submission (org + coordinator)', () => {
    it('extracts the church name as orgName, qualifying it for Create Organization + Contact', () => {
      expect(extractSubmission(seminarSubmission()).orgName).toBe('Crossroads Community Church');
    });

    it('splits the coordinator name first-token / remainder', () => {
      const result = extractSubmission(seminarSubmission());
      expect(result.firstName).toBe('Jane');
      expect(result.lastName).toBe('Van Dyke');
    });

    it('never lets the Church Name field masquerade as the person', () => {
      const churchOnly = submission([{ label: 'Church Name', type: 'text', value: 'First Baptist' }]);
      const result = extractSubmission(churchOnly);
      expect(result.firstName).toBeUndefined();
      expect(result.lastName).toBeUndefined();
      expect(result.orgName).toBe('First Baptist');
      expect(result.hasIdentity).toBeFalse();
    });

    it('recognizes the other org-ish labels too', () => {
      for (const label of ['Location Name', 'Organization', 'Ministry Name']) {
        expect(extractSubmission(submission([{ label, type: 'text', value: 'X' }])).orgName)
          .withContext(label)
          .toBe('X');
      }
    });
  });

  describe('combined-name splitting', () => {
    it('splits a plain "Name" field into first + rest', () => {
      const result = extractSubmission(submission([{ label: 'Name', type: 'text', value: 'Mary Anne Smith' }]));
      expect(result.firstName).toBe('Mary');
      expect(result.lastName).toBe('Anne Smith');
    });

    it('leaves lastName undefined for a single-token name', () => {
      const result = extractSubmission(submission([{ label: 'Your Name', type: 'text', value: 'Cher' }]));
      expect(result.firstName).toBe('Cher');
      expect(result.lastName).toBeUndefined();
      expect(result.hasIdentity).toBeTrue();
    });

    it('prefers a non-coordinator name field over the coordinator field', () => {
      const result = extractSubmission(
        submission([
          { label: 'Coordinator Name', type: 'text', value: 'Coord Person' },
          { label: 'Your Name', type: 'text', value: 'Actual Submitter' }
        ])
      );
      expect(result.firstName).toBe('Actual');
      expect(result.lastName).toBe('Submitter');
    });

    it('never splits when dedicated first/last fields exist, even partially filled', () => {
      const result = extractSubmission(
        submission([
          { label: 'First Name', type: 'text', value: 'Alex' },
          { label: 'Full Name', type: 'text', value: 'Someone Else' }
        ])
      );
      expect(result.firstName).toBe('Alex');
      expect(result.lastName).toBeUndefined();
    });
  });

  describe('phone and address', () => {
    it('carries object-shaped phone/address values through', () => {
      const phone = { countryCode: '1', area: '770', prefix: '555', line: '0100' };
      const address = { address1: '123 Main St', city: 'Sharpsburg', state: 'GA', zip: '30277' };
      const result = extractSubmission(
        submission([
          { label: 'Phone', type: 'phone', value: phone },
          { label: 'Address', type: 'address', value: address }
        ])
      );
      expect(result.phone).toEqual(jasmine.objectContaining(phone));
      expect(result.address).toEqual(jasmine.objectContaining(address));
    });

    it('omits the keys entirely for missing or non-object values (Firestore undefined-write guard)', () => {
      const result = extractSubmission(
        submission([{ label: 'Phone', type: 'phone', value: '770-555-0100' }])
      );
      expect('phone' in result).toBeFalse();
      expect('address' in result).toBeFalse();
    });
  });

  describe('identity and value hygiene', () => {
    it('hasIdentity is true with only an email', () => {
      const result = extractSubmission(submission([{ label: 'Email', type: 'email', value: 'a@b.com' }]));
      expect(result.hasIdentity).toBeTrue();
      expect(result.email).toBe('a@b.com');
    });

    it('hasIdentity is false for a submission with no person data at all', () => {
      const result = extractSubmission(submission([{ label: 'Comments', type: 'paragraph', value: 'hi' }]));
      expect(result.hasIdentity).toBeFalse();
    });

    it('treats whitespace-only and non-string text values as absent', () => {
      const result = extractSubmission(
        submission([
          { label: 'First Name', type: 'text', value: '   ' },
          { label: 'Email', type: 'email', value: 42 }
        ])
      );
      expect(result.firstName).toBeUndefined();
      expect(result.email).toBeUndefined();
      expect(result.hasIdentity).toBeFalse();
    });

    it('only reads names from text-type fields - a paragraph labeled Name is ignored', () => {
      const result = extractSubmission(submission([{ label: 'Name', type: 'paragraph', value: 'Alex Rivera' }]));
      expect(result.firstName).toBeUndefined();
      expect(result.hasIdentity).toBeFalse();
    });

    it('tolerates a submission with no fieldSnapshot or values at all', () => {
      const bare = new FormSubmissionModel();
      const result = extractSubmission(bare);
      expect(result.hasIdentity).toBeFalse();
      expect(result.email).toBeUndefined();
      expect(result.orgName).toBeUndefined();
    });

    it('tolerates a snapshot field whose value was never submitted', () => {
      const model = submission([{ label: 'First Name', type: 'text' }]);
      const result = extractSubmission(model);
      expect(result.firstName).toBeUndefined();
      expect(result.hasIdentity).toBeFalse();
    });
  });
});

describe('submitterIdentity', () => {
  it('prefers the email field', () => {
    expect(submitterIdentity(contactUsSubmission())).toBe('Alex.Rivera@Example.com');
  });

  it('falls back to a name-like text field when there is no email', () => {
    const noEmail = submission([
      { label: 'Message', type: 'paragraph', value: 'hi' },
      { label: 'Name', type: 'text', value: 'Alex Rivera' }
    ]);
    expect(submitterIdentity(noEmail)).toBe('Alex Rivera');
  });

  it('returns "Unknown" rather than guessing when neither exists', () => {
    expect(submitterIdentity(submission([{ label: 'Comments', type: 'paragraph', value: 'hi' }]))).toBe('Unknown');
  });

  it('returns "Unknown" for a submission with no snapshot at all', () => {
    expect(submitterIdentity(new FormSubmissionModel())).toBe('Unknown');
  });

  it('ignores an email field left blank and keeps falling back', () => {
    const blankEmail = submission([
      { label: 'Email', type: 'email', value: '  ' },
      { label: 'Name', type: 'text', value: 'Alex' }
    ]);
    expect(submitterIdentity(blankEmail)).toBe('Alex');
  });
});
