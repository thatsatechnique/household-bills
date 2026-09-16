# Data format

Everything the app knows lives in one JSON document. It is what Export JSON
writes, what Import JSON reads, what is mirrored to `localStorage` under
`billsBudgets.v1`, and what is written to the bound file when you use
"Save to a file…".

```jsonc
{
  "settings": {
    "leadDays": 3,          // alert window for "coming up"
    "notify": false,        // desktop notifications on/off
    "lastNotify": "",       // YYYY-MM-DD of the last notification sent
    "basis": "accrual"      // report chart basis: "accrual" | "cash"
  },
  "people": [
    { "id": "alex", "name": "Alex" },
    { "id": "sam",  "name": "Sam" }
  ],
  "bills": [
    {
      "id": "rent",
      "name": "Rent",
      "totalAmount": 2400.00,       // what is billed each period
      "period": "MONTHLY",          // WEEKLY | MONTHLY | QUARTERLY | YEARLY
      "dueDay": 1,                  // 1–31 or null; 31 clamps to short months
      "isActive": true,             // inactive bills are shown dimmed and excluded from totals
      "billMonth": null,            // QUARTERLY/YEARLY only: 1–12, one month the bill lands in
      "splits": [                   // null for an unsplit ("household") bill
        { "personId": "alex", "name": "Alex", "percent": 60, "amount": 1440.00 },
        { "personId": "sam",  "name": "Sam",  "percent": 40, "amount": 960.00 }
      ],
      "paidMonths": { "2026-08": true },          // paid checklist, keyed by month
      "actuals":    { "2026-08": 2400.00 },       // what it actually cost that month
      "fund": null                                // QUARTERLY/YEARLY only, see below
    }
  ]
}
```

## Splits

Both `percent` and `amount` are always stored. A split is treated as
percent-driven when the percents sum to 100 (±0.01); otherwise the fixed
amounts win. That is how the app tells the two editor modes apart without a
separate flag, and it means a file edited by hand still behaves sensibly.

## Monthly normalization

Every figure that is compared across bills is normalized to a monthly amount:

| period    | factor  |
|-----------|---------|
| WEEKLY    | × 52/12 |
| MONTHLY   | × 1     |
| QUARTERLY | ÷ 3     |
| YEARLY    | ÷ 12    |

## Billing cycles

Weekly and monthly bills are due every month. A quarterly or yearly bill is
due only in its cycle months, anchored on `billMonth`: quarterly with
`billMonth: 2` means Feb · May · Aug · Nov; yearly with `billMonth: 11` means
November only. The checklist, the alert bar and the set-aside panel all use
this. When `billMonth` is missing on import it is inferred from the most
recent recorded actual, or defaults to January.

## Set-aside funds

```jsonc
"fund": { "opening": 40.00, "asOf": "2026-08" }
```

`opening` is the balance at the **start** of `asOf`, before that month's
contribution. The current balance is then

```
opening + (months from asOf to now, inclusive) × monthly − Σ actuals recorded in that range
```

so the fund accrues automatically and every recorded payment draws it down.
Editing the balance in the UI re-anchors `asOf` to the current month. A bill
that gets a cycle for the first time is seeded "on track": enough banked that
the remaining monthly contributions land exactly on the amount due.

## Reports

* **Budgeted** is always the normalized monthly figure, so a quarterly bill
  reads as one third every month.
* **Cash** basis puts each actual in the month it was paid.
* **Accrual** basis spreads a quarterly or yearly actual back across the
  months it covers. Spill into the previous year is trimmed at January.
* Months with no recorded actual are `null`, not `0`, and draw no bar.
