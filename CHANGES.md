# Serene Marquee — Update Pack (August 2026)

Drop these files into the repo at the same paths, then run the SQL migration.
Verified with `tsc --noEmit` and a full `next build` — all 17 routes compile.

## Step 1 — Run the database migration FIRST

`supabase/migration-2026-08.sql` → Supabase Dashboard → SQL Editor → New query → paste → Run.

Nothing else works until this runs (new tables and columns). It is idempotent, so
running it twice is safe.

## Step 2 — Copy the files

### New files
| Path | What it is |
|---|---|
| `supabase/migration-2026-08.sql` | All schema changes |
| `src/components/SessionContext.tsx` | Makes the signed-in role available to every client page |
| `src/components/DiscountField.tsx` | Discount input with the role's ceiling built in |
| `src/lib/exportLedger.ts` | CSV + Excel download helpers (no new npm packages) |
| `src/app/(app)/ledger/vendors/page.tsx` | The Vendors page |
| `src/app/(app)/ledger/vendors/loading.tsx` | Its loading skeleton |
| `src/app/(app)/support/page.tsx` | Help & Support — ticket reporting for all employees |
| `src/app/(app)/support/loading.tsx` | Its loading skeleton |

### Replaced files
`src/types/index.ts`, `src/lib/constants.ts`, `src/components/AppShell.tsx`,
`src/components/Sidebar.tsx`, `src/app/(app)/ledger/page.tsx`,
`src/app/(app)/ledger/salaries/page.tsx`, `src/app/(app)/bookings/page.tsx`,
`src/app/(app)/bookings/[id]/page.tsx`, `src/app/(app)/bookings/new/page.tsx`,
`src/app/(app)/bookings/[id]/edit/page.tsx`, `src/app/(app)/dev/page.tsx`,
`src/app/(app)/admin/staff/page.tsx`

The two booking forms only changed in four small places each — see
`PATCH-new-booking.diff` and `PATCH-edit-booking.diff` if you'd rather apply the
change by hand than overwrite the file.

---

## What each request became

### 1. Hall charge — Rs. 50,000 for all venues
`update public.venues set hall_charge = 50000;` in the migration. The calculator
already reads the per-venue figure from the table, so no code change was needed
beyond the `HALL_CHARGE` constant in `constants.ts`. The 200-guest waiver rule is
untouched.

### 2. Payroll — advances, loans, bonuses, salary changes, add/remove staff

Three new tables: `employee_advances`, `employee_adjustments`,
`employee_salary_changes`.

- **Advance / Loan** — record the amount handed over plus the agreed monthly
  instalment. It optionally posts to the ledger as an expense at the same time
  (checkbox, on by default), since the money physically left the till.
- **Recovery** — an "Outstanding Advances & Loans" panel shows every open balance.
  Pressing *Deduct* books that month's instalment against the salary. Nothing is
  deducted silently; it's always an explicit action, and the outstanding balance
  drops accordingly.
- **Bonus / Deduction** — one-off adjustments that apply to the selected month
  only. Net Payable = base + bonuses − deductions, and the payment amount
  pre-fills with the net figure.
- **Salary change** — editing an employee's salary writes a row to
  `employee_salary_changes` with the old value, new value, date and reason, so
  raises are auditable rather than overwriting history.
- **Add / remove** — "+ Add Employee", and "Mark as Left" for leavers. Leavers are
  deactivated rather than deleted so their past salary payments stay attached to
  the ledger; a *Reinstate* button brings them back if they return, and "Show past
  employees" reveals them.

Also: payroll CSV/Excel export, and salary entries now carry `employee_id` +
`salary_month` instead of being matched by description text. The migration
backfills your existing salary rows so past months still show correctly.

### 3. Ledger — refunds and month-end downloads

- **Refund** — once a booking is cancelled, a *Refund Advance* button appears on
  the booking page. Cancelling a booking that has an advance now opens the refund
  dialog automatically. The amount is editable (so you can retain the
  non-refundable token and return the rest), and it posts a matching expense to
  the ledger plus stamps `advance_refunded` / `refund_amount` / `refunded_at` on
  the booking. The Balance Due line accounts for it.
- **Month-end export** — the ledger now has a month selector; the summary cards
  and table follow it. *⤓ CSV* and *⤓ Excel* download that month, including a
  header block with the period and totals. No new dependency: the Excel file is
  an Excel-native HTML table saved as `.xls`, and the CSV carries a UTF-8 BOM so
  the Rs. and Urdu characters don't come out garbled.

### 4. Vendors page

New page at `/ledger/vendors`, reached by a **Vendors** button sitting right next
to **Payroll / Salaries** on the Ledger page. Seeded with your nine:

Grocery – Faisal Store · Beef – Chaudhry Beef · Mutton – *(no name)* ·
Chicken – Saqib Chicken · Gas Cylinder – Asif Gas Cylinder ·
Decoration – Abbasi Sahab · Laundry – Danish · Mineral Water – *(no name)* ·
Cold Drinks – *(no name)*

Every shop name is editable ("Rename / Edit"), and vendors can be added or
removed. The seed only runs if the table is empty, so a later re-run of the SQL
will never overwrite a rename. You can also record a payment against a vendor,
which posts to the ledger and gives you per-vendor monthly and all-time totals.

### 5. Bookings search

The search bar now matches **client name** or **order number** — `SM-000123`,
`000123` and `123` all find the same booking, and a 4+ digit entry also matches
the client's phone. **Date** is a separate field with a native calendar picker,
so nobody has to guess the format. A Clear button resets both, and a count line
shows what's being filtered.

### 6. Roles

- **Discount limits** — Manager Rs. 30,000, General Manager Rs. 50,000 per
  booking; Admin and Developer unlimited; Staff and Owner none. The field shows
  the user's own ceiling, turns red past it, and blocks Save. It's also enforced
  by a Postgres trigger (`enforce_discount_limit`), so the limit holds even if
  someone hits the database directly.
- **Owner / CEO is monitor-only** — Mahmud Ali Shah and Afeefa Batool keep read
  access to everything they could see before, but every create/edit/delete button
  is hidden, the booking forms refuse to open, and RLS rejects any write. Set both
  accounts to the `owner` role in Staff & Access.
- The Staff & Access screen now shows each person's discount limit and a Role
  Policy card summarising the rules.

### 7. Ticketing for all employees

- **Help & Support** (`/support`) — visible to everyone in the sidebar. Any
  employee files an issue with a type and urgency, then follows it: they see the
  status, the developer's replies, and the resolution note. They only ever see
  their own tickets (enforced by RLS, not just hidden).
- **Developer Console** (`/dev`) — now a real queue: counts for open / in progress
  / resolved / urgent waiting, a status filter, priority editing, Start → Resolve
  transitions, threaded replies back to the reporter, and a resolution note that
  the reporter sees on their side. The staff overview gained a Discount Limit
  column.

---

## Two things worth knowing

**Owner accounts must be role `owner`.** The monitor-only rule keys off the role,
not the name. Check both CEO accounts in Staff & Access after deploying.

**The Vendors page shows names to everyone, money only to ledger accounts.** A
staff member without ledger access sees the shop list and contacts but dashes
instead of amounts — the ledger RLS does that on its own, and the page explains
it rather than looking broken.
