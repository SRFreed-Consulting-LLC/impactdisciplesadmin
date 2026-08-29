import { HomePageImageModel } from '@impact-common/shared/models/domain/home-page-image.model';
import { duplicateOrdersIn } from './home-page-images.component';

// The home slider sorts on `order`, and nothing has ever stopped two slides
// sharing a number. Prod had three such pairs when this was written (orders
// 1, 3 and 4), so the sequence a visitor sees was decided by Firestore's
// return order rather than by staff - and the screen showed no sign of it.
//
// Pure function, tested without a component, a service or an emulator.

/** A slide with only the field under test filled in. */
function slide(order: number | undefined, isActive = true): HomePageImageModel {
  return { order, isActive } as unknown as HomePageImageModel;
}

describe('duplicateOrdersIn', () => {
  it('finds nothing when every slide has its own number', () => {
    expect(duplicateOrdersIn([slide(0), slide(1), slide(2)])).toEqual([]);
  });

  it('reports a number used twice', () => {
    expect(duplicateOrdersIn([slide(0), slide(1), slide(1)])).toEqual([1]);
  });

  it('reports every clashing number, in ascending order', () => {
    // The real prod shape when this was written.
    const rows = [slide(0), slide(1), slide(1), slide(2), slide(3), slide(3), slide(4), slide(4)];
    expect(duplicateOrdersIn(rows)).toEqual([1, 3, 4]);
  });

  it('reports a number once however many slides share it', () => {
    expect(duplicateOrdersIn([slide(2), slide(2), slide(2)])).toEqual([2]);
  });

  it('counts INACTIVE slides too', () => {
    // An off slide still holds its number: it is exactly what makes the next
    // slide someone activates land somewhere they did not expect. Two of the
    // three prod clashes involved an inactive slide.
    expect(duplicateOrdersIn([slide(1, true), slide(1, false)])).toEqual([1]);
  });

  it('ignores slides with no order rather than grouping them together', () => {
    // undefined is not a position - treating several as equal would invent a
    // clash that does not exist.
    expect(duplicateOrdersIn([slide(undefined), slide(undefined), slide(5)])).toEqual([]);
  });

  it('handles an empty list', () => {
    expect(duplicateOrdersIn([])).toEqual([]);
  });
});
