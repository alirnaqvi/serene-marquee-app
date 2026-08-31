import { CONFIRMATION_MINIMUM } from "@/lib/constants";

export type Venue = {
  id: string;
  name: string;
  capacity: number;
  hall_charge: number;
  min_waiver: number;
  decoration_from: number;
};

export type Menu = {
  id: string;
  name: string;
  rate: number;
  items: string;
};

// Every add-on is priced PER HEAD — quantity always follows the guaranteed
// guest count. default_qty_mode is retained so old rows still parse, but it is
// no longer read anywhere: treat every item as per head.
export type AddonItem = {
  id: string;
  category: string;
  name: string;
  price: number;
  default_qty_mode?: "guests" | "one";
  sort_order: number;
};

export type BookingAddon = {
  id: string;
  booking_id: string;
  addon_item_id: string | null;
  name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
};

export type Role = "owner" | "admin" | "manager" | "general_manager" | "developer" | "staff";

export type Profile = {
  id: string;
  full_name: string;
  username?: string | null;
  role: Role;
  can_view_ledger: boolean;
  created_at?: string;
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  general_manager: "General Manager",
  developer: "Developer",
  staff: "Staff",
};

// Roles that automatically see the ledger/income-expense/payroll data.
// General Manager and Developer are deliberately excluded — even if
// can_view_ledger were somehow set true for one, RLS still blocks it.
export const LEDGER_ROLES: Role[] = ["owner", "admin", "manager"];

// Staff & Access screen — per the owner's finalized policy:
//   - Owner, Admin: can VIEW it, cannot edit
//   - Manager, General Manager: cannot see it at all
//   - Developer: the only role that can EDIT it
export const STAFF_EDIT_ROLES: Role[] = ["developer"];
export const STAFF_VIEW_ROLES: Role[] = ["owner", "admin", "developer"];

// Developer Console — a separate area for the one role whose job is
// watching over the system/staff rather than doing bookings day-to-day.
export const DEVELOPER_ROLES: Role[] = ["developer"];

// ---------------------------------------------------------------------------
// MONITOR-ONLY ROLES
// Owner / CEO accounts (Mahmud Ali Shah, Afeefa Batool) can see everything
// they could before, but cannot create, edit or delete anything anywhere in
// the app. The UI hides every write control for them; RLS in the database
// blocks the writes as well, so this holds even if the UI is bypassed.
// ---------------------------------------------------------------------------
export const READ_ONLY_ROLES: Role[] = ["owner"];

export function isReadOnlyRole(role: Role): boolean {
  return READ_ONLY_ROLES.includes(role);
}

// ---------------------------------------------------------------------------
// DISCOUNT AUTHORITY — flat Rs. ceiling on the discount a role may put on a
// single booking. Infinity means "no limit". Mirrored by the
// enforce_discount_limit() trigger in the database.
// ---------------------------------------------------------------------------
export const DISCOUNT_LIMITS: Record<Role, number> = {
  owner: 0,                // monitor only
  staff: 0,
  manager: 100000,         // currently Zain Syed
  general_manager: 200000, // currently Ikram Abbasi
  admin: Infinity,
  developer: Infinity,
};

// ---------------------------------------------------------------------------
// CHAIN OF COMMAND FOR DISCOUNT APPROVALS
//     Admin (high)  ->  General Manager  ->  Manager (low)
// A request goes to everyone above the requester, and the first of them to act
// on it decides it. Mirrored by approver_roles_for() in the database.
// ---------------------------------------------------------------------------
export const DISCOUNT_APPROVERS: Record<Role, Role[]> = {
  staff: ["manager", "general_manager", "admin"],
  manager: ["general_manager", "admin"],
  general_manager: ["admin"],
  admin: [],     // no ceiling to clear
  developer: [],
  owner: [],     // monitor only
};

export function approversFor(role: Role): Role[] {
  return DISCOUNT_APPROVERS[role] ?? [];
}

export type ApprovalStatus = "pending" | "approved" | "rejected";

/**
 * A request to exceed your own discount ceiling on one booking. Once approved
 * it acts as a single-use permit: the database spends it on the next booking
 * saved with a discount up to the approved amount, then marks it consumed.
 */
export type DiscountApproval = {
  id: string;
  booking_id: string | null;
  client_name: string | null;
  event_date: string | null;
  booking_total: number | null;
  requested_amount: number;
  requester_limit: number;
  reason: string | null;
  requested_by: string;
  requester_role: Role;
  approver_roles: Role[];
  status: ApprovalStatus;
  approved_amount: number | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  consumed_booking_id: string | null;
  consumed_at: string | null;
  created_at: string;
  profiles?: { full_name: string } | null; // joined requester name
};

export function discountLimitFor(role: Role): number {
  return DISCOUNT_LIMITS[role] ?? 0;
}

export function discountLimitLabel(role: Role): string {
  const lim = discountLimitFor(role);
  if (lim === Infinity) return "No limit";
  if (lim === 0) return "Not permitted";
  return "Rs. " + lim.toLocaleString("en-PK") + " per booking";
}

export type BookingStatus = "Tentative" | "Confirmed" | "Cancelled";
export type Session = "Lunch" | "Dinner";
export type FilerStatus = "Filer" | "Non-Filer";

export type ClientTitle = "Mr." | "Mrs." | "Ms.";

export const CLIENT_TITLES: ClientTitle[] = ["Mr.", "Mrs.", "Ms."];

export type Booking = {
  id: string;
  booking_number: number | null; // sequential, human-friendly reference (e.g. shown as SM-000123)
  venues: string[];
  session: Session;
  event_date: string; // ISO date, e.g. 2026-09-12
  title: ClientTitle | null; // optional — an organization or "Ahmed Family" has none
  client: string;
  phone: string | null;
  phone2: string | null;
  cnic: string | null;
  email: string | null;
  function_type: string;
  function_type_other: string | null;
  entry_test_type: string | null; // e.g. "MDCAT", "ECAT" — only used when function_type === "Entry Test"
  guests: number;
  menu_id: string | null;
  is_custom_menu: boolean;
  custom_menu_total: number;
  addons_total: number; // extra items added on top of a regular menu's per-head rate
  removed_menu_items: string[] | null; // items unchecked from the selected offered menu's included list
  discount: number; // flat Rs. amount (not a percentage)
  reference: string | null;
  filer: FilerStatus;
  decoration: number;
  cooling: boolean;
  heaters: number;
  advance: number;
  advance_refunded: boolean; // set when a cancelled booking's advance is returned
  refund_amount: number;
  refunded_at: string | null;
  notes: string | null;
  status: BookingStatus;
  created_by: string | null;
  created_at: string;
};

export type LedgerEntry = {
  id: string;
  entry_date: string;
  type: "income" | "expense";
  description: string;
  amount: number;
  booking_id: string | null;
  handed_to: string | null; // for expenses: who received the money
  employee_id: string | null; // set on payroll entries
  vendor_id: string | null; // set on vendor payments
  salary_month: string | null; // 'YYYY-MM' on salary entries
  category: string | null; // 'salary' | 'advance' | 'vendor' | 'refund' | null
  created_by: string | null;
  created_at: string;
  profiles?: { full_name: string } | null; // joined author name
};

export type Employee = {
  id: string;
  full_name: string;
  designation: string;
  monthly_salary: number;
  phone: string | null;
  joined_on: string | null;
  left_on: string | null;
  active: boolean;
  created_at: string;
};

// An advance or a loan handed to an employee, recovered by a fixed monthly
// instalment cut from their salary until the full amount is paid back.
export type EmployeeAdvance = {
  id: string;
  employee_id: string;
  kind: "advance" | "loan";
  amount: number;
  monthly_deduction: number;
  issued_on: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

// A one-off change to a single month's pay: a bonus (adds), a deduction
// (subtracts), or a repayment (subtracts, and is tied to the advance/loan
// it is paying down).
export type EmployeeAdjustment = {
  id: string;
  employee_id: string;
  month: string; // 'YYYY-MM'
  kind: "bonus" | "deduction" | "repayment";
  amount: number;
  advance_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export type SalaryChange = {
  id: string;
  employee_id: string;
  old_salary: number;
  new_salary: number;
  effective_from: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
};

// Shop the marquee buys from. Category is the thing supplied (Grocery, Beef,
// Chicken...); shop_name is the shop currently used for it and is fully
// editable — today's Faisal Store may be someone else next year.
export type Vendor = {
  id: string;
  category: string;
  shop_name: string | null;
  contact: string | null;
  notes: string | null;
  active: boolean;
  sort_order: number;
  created_at: string;
};

// One line of a vendor's account diary.
//   credit = a bill received from the vendor (increases what we owe)
//   debit  = a payment made to the vendor    (reduces what we owe)
export type VendorTransaction = {
  id: string;
  vendor_id: string;
  txn_date: string;
  description: string | null;
  debit: number;
  credit: number;
  ledger_entry_id: string | null;
  created_by: string | null;
  created_at: string;
};

export type TicketStatus = "open" | "in_progress" | "resolved";
export type TicketPriority = "low" | "normal" | "high" | "urgent";

export type SupportTicket = {
  id: string;
  title: string;
  description: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  category: string | null;
  related_profile_id: string | null;
  resolution_note: string | null;
  resolved_by: string | null;
  created_by: string | null;
  created_at: string;
  resolved_at: string | null;
};

export type TicketComment = {
  id: string;
  issue_id: string;
  body: string;
  created_by: string | null;
  created_at: string;
};

export const TICKET_CATEGORIES = [
  "Bug / Not Working",
  "Wrong Calculation",
  "Login or Access",
  "Printing / PDF",
  "Feature Request",
  "Other",
] as const;

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
};

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

/**
 * The client's name with their title in front, where one was given.
 * Used everywhere the host is displayed — list, calendar, agreement, ledger —
 * so the title never has to be re-joined by hand.
 */
export function clientName(b: Pick<Booking, "title" | "client">): string {
  return b.title ? `${b.title} ${b.client}` : b.client;
}

/**
 * A booking is only Confirmed once an advance of at least
 * CONFIRMATION_MINIMUM (Rs. 25,000) has actually been received. Anything less
 * — including nothing at all — leaves it Tentative, whatever the form said.
 * The same rule is enforced by the enforce_advance_status() trigger in the
 * database, so it holds even outside the app.
 */
export function canConfirmBooking(advance: number): boolean {
  return advance >= CONFIRMATION_MINIMUM;
}

export function statusForAdvance(
  advance: number,
  desired: BookingStatus
): BookingStatus {
  if (desired === "Cancelled") return "Cancelled";
  return canConfirmBooking(advance) ? desired : "Tentative";
}

export function bookingRef(b: Pick<Booking, "booking_number" | "id">): string {
  return b.booking_number ? `SM-${String(b.booking_number).padStart(6, "0")}` : b.id.slice(0, 8).toUpperCase();
}

export const FUNCTION_TYPES = [
  "Walima",
  "Wedding",
  "Barat",
  "Mehndi",
  "Engagement",
  "Birthday Party",
  "Corporate Event",
  "Entry Test",
  "Other",
] as const;

// Entry Test bookings skip menu selection entirely — everyone is charged
// this flat per-head rate instead (see ENTRY_TEST_RATE in lib/constants).
export function isEntryTestFunction(functionType: string): boolean {
  return functionType === "Entry Test";
}
