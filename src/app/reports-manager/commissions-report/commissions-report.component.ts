import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { CheckoutForm, CartItem } from '@impact-common/shared/models/utils/cart.model';
import { CouponModel } from '@impact-common/shared/models/utils/coupon.model';
import { dateFromTimestamp } from '@impact-common/shared/utils/date-from-timestamp';
import { QueryParam, WhereFilterOperandKeys } from 'src/app/common/dao/firebase.dao';
import { CouponService } from 'src/app/common/services/data/coupon.service';
import { PurchasesService } from 'src/app/common/services/data/purchases.service';
import { SharedModule } from 'src/app/shared/shared.module';
import { exportToExcel } from 'src/app/shared/table-export.util';

/** One line of a purchase, priced as the customer actually paid for it. */
export interface CommissionLine {
  itemName: string;
  quantity: number;
  /** Per-unit price after the coupon discount. */
  unitPrice: number;
  /** `unitPrice` x `quantity`. */
  subtotal: number;
}

/** One purchase made against an affiliate coupon. */
export interface CommissionPurchase {
  id: string;
  purchaser: string;
  email: string;
  dateProcessed: Date | null;
  lines: CommissionLine[];
  /** Sum of the line subtotals - goods only, no shipping and no tax. */
  total: number;
}

/** All of one affiliate coupon's purchases in the selected month. */
export interface CommissionGroup {
  code: string;
  /** `affilliateName` when the coupon carries one; blank on every coupon
   *  today, so the template falls back to the code. */
  affiliateName: string;
  percentOff: number | null;
  purchases: CommissionPurchase[];
  total: number;
  /**
   * What the affiliate is owed: `AFFILIATE_COMMISSION_RATE` of `total`.
   *
   * NOT derived from `percentOff`. The two are both 10 today and that is a
   * coincidence: `percentOff` is the discount the CUSTOMER receives, and the
   * commission is what the AFFILIATE earns on the discounted sale. Reading
   * the rate off the coupon would silently change everyone's pay the day
   * somebody runs a 15%-off promotion (owner, 2026-09-04).
   */
  commission: number;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * What an affiliate earns on the goods sold through their code.
 *
 * A FLAT 10% FOR EVERY AFFILIATE, and deliberately not read from
 * `CouponModel.percentOff`. That field is the discount the CUSTOMER gets;
 * this is what the affiliate is paid. They both happen to be 10 right now,
 * which is exactly what would make wiring one to the other look correct -
 * and would then change what nine people are paid the first time a coupon's
 * discount is adjusted for a promotion.
 */
const AFFILIATE_COMMISSION_RATE = 0.1;

/**
 * Reports Manager > Commissions - what each affiliate's coupon code sold in
 * a given month.
 *
 * Grouped: coupon, then purchase, then the lines of that purchase, with a
 * total at the purchase level and at the coupon level.
 *
 * THIS REPORT AGGREGATES, AND IT IS THE ONLY ONE THAT DOES. Group-by was
 * deliberately stripped out of Purchase Report and Subscriber Report on
 * 2026-08-15 - "every row is always one real document" - and
 * docs/reports-manager.md carried that as a rule. This is a considered
 * exception (owner, 2026-09-04), not a drift back: a commission statement
 * whose subtotals you cannot see is not a commission statement. Do not
 * "restore consistency" by flattening it.
 *
 * WHAT COUNTS AS AN AFFILIATE COUPON: `CouponModel.isAffilliate` - note the
 * double-l, which is the spelling in the model and in Firestore. There are 9
 * on production, all 10% off. The sibling fields are spelled inconsistently
 * too (`affilliateName`, but `affiliatePaypalAccount`); that is the data, not
 * a typo here.
 *
 * WHAT A TOTAL MEANS HERE (owner's call, 2026-09-04): the price of the GOODS,
 * excluding shipping and tax. It is summed from the line items rather than
 * read off `CheckoutForm.total`, for two reasons. `total` is the whole charge
 * - it includes `shippingRate` and `estimatedTaxes`, which are not the
 * affiliate's to be credited with. And it is not always internally
 * consistent in the older records: one live purchase stores `total: 150`
 * where its own parts sum to 153.26. Summing the lines also means the column
 * of subtotals visibly adds up to the total beside it, which is the first
 * thing anyone checking a commission statement by hand will try.
 *
 * FULLY REFUNDED PURCHASES ARE EXCLUDED (owner's call, same day).
 * `refundedAt` is written only on a full refund - see
 * functions/src/store-refund.functions.ts, which sets it under
 * `plan.isFullRefund` - so its presence is the test. A PARTIAL refund still
 * counts, at its original value; netting partials off would need a rule
 * about which line the money came off, and nobody has one.
 */
@Component({
  selector: 'app-commissions-report',
  standalone: true,
  imports: [
    CommonModule, SharedModule, MatButtonModule, MatFormFieldModule,
    MatIconModule, MatProgressSpinnerModule, MatSelectModule
  ],
  templateUrl: './commissions-report.component.html',
  styleUrl: './commissions-report.component.scss'
})
export class CommissionsReportComponent {
  private readonly purchasesService = inject(PurchasesService);
  private readonly couponService = inject(CouponService);

  readonly months = MONTHS;

  /** Newest first - a commission run is nearly always about a recent month.
   *  Starts at 2024, the year of the earliest affiliate purchase in the
   *  data, and runs one year past today so a January selection is possible
   *  in December. */
  readonly years: number[] = (() => {
    const thisYear = new Date().getFullYear();
    const out: number[] = [];
    for (let y = thisYear + 1; y >= 2024; y--) {
      out.push(y);
    }
    return out;
  })();

  readonly month = signal(new Date().getMonth());
  readonly year = signal(new Date().getFullYear());

  readonly loading = signal(false);
  readonly errorMessage = signal('');
  readonly generated = signal(false);
  readonly groups = signal<CommissionGroup[]>([]);

  private readonly collapsed = signal<ReadonlySet<string>>(new Set<string>());

  readonly grandTotal = computed(() =>
    this.groups().reduce((sum, group) => sum + group.total, 0)
  );

  readonly grandCommission = computed(() =>
    this.groups().reduce((sum, group) => sum + group.commission, 0)
  );

  readonly purchaseCount = computed(() =>
    this.groups().reduce((sum, group) => sum + group.purchases.length, 0)
  );

  readonly monthLabel = computed(() => `${MONTHS[this.month()]} ${this.year()}`);

  constructor() {
    void this.load();
  }

  isCollapsed(code: string): boolean {
    return this.collapsed().has(code);
  }

  toggle(code: string): void {
    const next = new Set(this.collapsed());
    if (!next.delete(code)) {
      next.add(code);
    }
    this.collapsed.set(next);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');
    try {
      // One real Firestore range query on dateProcessed, then the coupon
      // match client-side. The alternative - `couponCode in [...9 codes]`
      // crossed with the range - needs a composite index per shape and buys
      // nothing: a month of purchases is a small set, and the coupon list
      // changes whenever somebody adds an affiliate.
      // Only the affiliate coupons, not all of them: 9 documents instead of
      // 33 on production. A single-field equality is served by Firestore's
      // automatic index, so this costs no index to deploy.
      //
      // Verified safe before switching (2026-09-04) rather than assumed: a
      // Firestore `== true` matches a real boolean ONLY, where the JS filter
      // this replaced matched anything truthy. Every coupon in both projects
      // stores a genuine boolean and the two agree exactly, so nothing is
      // dropped. If a coupon is ever written with a string "true", this
      // query will silently skip it - and skipping an affiliate means not
      // paying them.
      const [coupons, purchases] = await Promise.all([
        this.couponService.getAllByValue('isAffilliate', true),
        this.purchasesService.queryAllByMultiValue(this.monthRange())
      ]);

      this.groups.set(this.buildGroups(coupons ?? [], purchases ?? []));
      this.generated.set(true);
    } catch (err) {
      // Distinct from "no commissions this month" on purpose - an empty
      // table over a query that failed is a lie about what was sold.
      this.errorMessage.set(
        'Could not load commissions. ' +
        ((err as { message?: string })?.message ?? 'Please try again.')
      );
      this.groups.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * The selected month as a half-open range.
   *
   * Built with `new Date(year, month + 1, 0, 23, 59, 59, 999)` for the end -
   * day 0 of the NEXT month is the last day of this one, which is also how
   * February and leap years take care of themselves.
   * @return {QueryParam[]} A >= and a <= on dateProcessed.
   */
  private monthRange(): QueryParam[] {
    const start = new Date(this.year(), this.month(), 1, 0, 0, 0, 0);
    const end = new Date(this.year(), this.month() + 1, 0, 23, 59, 59, 999);
    return [
      new QueryParam('dateProcessed', WhereFilterOperandKeys.moreOrEqual, start),
      new QueryParam('dateProcessed', WhereFilterOperandKeys.lessOrEqual, end)
    ];
  }

  private buildGroups(coupons: CouponModel[], purchases: CheckoutForm[]): CommissionGroup[] {
    // Keyed on the trimmed, upper-cased code. Firestore equality is byte
    // equality and nothing normalises a coupon code on the way in, so
    // matching on the raw string would drop a purchase over a stray space.
    //
    // `isAffilliate` is re-checked even though the query already filtered on
    // it - this method is pure and takes whatever list it is handed, and the
    // check costs nothing next to being wrong about who gets paid.
    const affiliates = new Map<string, CouponModel>();
    for (const coupon of coupons) {
      if (coupon.isAffilliate && coupon.code) {
        affiliates.set(coupon.code.trim().toUpperCase(), coupon);
      }
    }

    const byCode = new Map<string, CommissionPurchase[]>();
    for (const purchase of purchases) {
      const code = (purchase.couponCode ?? '').trim().toUpperCase();
      if (!code || !affiliates.has(code)) {
        continue;
      }
      // Fully refunded - the sale was unwound, so it earns nothing.
      if ((purchase as { refundedAt?: unknown }).refundedAt) {
        continue;
      }
      const row = this.toPurchase(purchase);
      const list = byCode.get(code);
      if (list) {
        list.push(row);
      } else {
        byCode.set(code, [row]);
      }
    }

    return [...byCode.entries()]
      .map(([code, list]) => {
        const coupon = affiliates.get(code);
        const percentOff = coupon?.percentOff ?? null;
        const total = list.reduce((sum, p) => sum + p.total, 0);
        return {
          code,
          affiliateName: coupon?.affilliateName?.trim() ?? '',
          percentOff,
          // Oldest first within a coupon - a statement reads as a ledger.
          purchases: list.sort(
            (a, b) => (a.dateProcessed?.getTime() ?? 0) - (b.dateProcessed?.getTime() ?? 0)
          ),
          total,
          // Rounded to the cent HERE, not at render time: the figure a
          // person is paid should be the figure they were shown, and a
          // grand total that sums unrounded values disagrees with the
          // column above it by a penny often enough to be noticed.
          commission: Math.round(total * AFFILIATE_COMMISSION_RATE * 100) / 100
        };
      })
      // Biggest earner first: the point of the month's statement is who is
      // owed what, and a code with nothing in it should not lead.
      .sort((a, b) => b.total - a.total || a.code.localeCompare(b.code));
  }

  private toPurchase(purchase: CheckoutForm): CommissionPurchase {
    const lines = (purchase.cartItems ?? []).map((item) => this.toLine(item));
    return {
      id: purchase.id!,
      purchaser: [purchase.firstName, purchase.lastName].filter(Boolean).join(' ').trim() ||
        purchase.email || '(no name)',
      email: purchase.email ?? '',
      dateProcessed: dateFromTimestamp(purchase.dateProcessed) as Date,
      lines,
      total: lines.reduce((sum, line) => sum + line.subtotal, 0)
    };
  }

  private toLine(item: CartItem): CommissionLine {
    // `discountPrice` is the per-unit price after the coupon came off, and
    // it is what the customer actually paid. `salePrice` is the next best
    // answer (a product on sale with no coupon applied to that line), and
    // list `price` the last. Falling straight back to `price` would report
    // every affiliate sale about 10% high.
    const unitPrice = item.discountPrice ?? item.salePrice ?? item.price ?? 0;
    const quantity = item.orderQuantity ?? 0;
    return {
      itemName: item.itemName ?? '(unnamed item)',
      quantity,
      unitPrice,
      subtotal: unitPrice * quantity
    };
  }

  /**
   * Exports one row per line item, carrying its coupon and purchase down
   * onto it.
   *
   * Flattened deliberately: a spreadsheet with merged group headers cannot
   * be sorted or pivoted, which is the only reason to take this into a
   * spreadsheet at all. The purchase total repeats on each of its lines.
   */
  exportExcel(): void {
    const rows = this.groups().flatMap((group) =>
      group.purchases.flatMap((purchase) =>
        purchase.lines.map((line) => ({
          code: group.code,
          affiliate: group.affiliateName || group.code,
          purchaser: purchase.purchaser,
          email: purchase.email,
          dateProcessed: purchase.dateProcessed,
          itemName: line.itemName,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          subtotal: line.subtotal,
          purchaseTotal: purchase.total,
          couponTotal: group.total,
          couponCommission: group.commission
        }))
      )
    );

    void exportToExcel(
      rows,
      [
        { header: 'Coupon', value: (r) => r.code },
        { header: 'Affiliate', value: (r) => r.affiliate },
        { header: 'Purchaser', value: (r) => r.purchaser },
        { header: 'Email', value: (r) => r.email },
        { header: 'Purchase Date', value: (r) => r.dateProcessed ?? '' },
        { header: 'Item', value: (r) => r.itemName },
        { header: 'Qty', value: (r) => r.quantity },
        { header: 'Unit Price', value: (r) => r.unitPrice },
        { header: 'Subtotal', value: (r) => r.subtotal },
        { header: 'Purchase Total', value: (r) => r.purchaseTotal },
        // Repeated on every line of the coupon, so the sheet can be pivoted
        // on Coupon without losing the two figures the report exists for.
        { header: 'Coupon Total', value: (r) => r.couponTotal },
        { header: 'Coupon Commission', value: (r) => r.couponCommission }
      ],
      `commissions-${this.year()}-${String(this.month() + 1).padStart(2, '0')}.xlsx`,
      'Commissions'
    );
  }
}
