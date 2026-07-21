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

export type AddonItem = {
  id: string;
  category: string;
  name: string;
  price: number;
  default_qty_mode: "guests" | "one";
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

export type BookingStatus = "Tentative" | "Confirmed" | "Cancelled";
export type Session = "Lunch" | "Dinner";
export type FilerStatus = "Filer" | "Non-Filer";

export type Booking = {
  id: string;
  booking_number: number | null; // sequential, human-friendly reference (e.g. shown as SM-000123)
  venues: string[];
  session: Session;
  event_date: string; // ISO date, e.g. 2026-09-12
  client: string;
  phone: string | null;
  phone2: string | null;
  cnic: string | null;
  email: string | null;
  function_type: string;
  function_type_other: string | null;
  guests: number;
  menu_id: string | null;
  is_custom_menu: boolean;
  custom_menu_total: number;
  addons_total: number; // extra items added on top of a regular menu's per-head rate
  discount: number; // flat Rs. amount (not a percentage)
  reference: string | null;
  filer: FilerStatus;
  decoration: number;
  cooling: boolean;
  heaters: number;
  advance: number;
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
  created_by: string | null;
  created_at: string;
  profiles?: { full_name: string } | null; // joined author name
};

export type Employee = {
  id: string;
  full_name: string;
  designation: string;
  monthly_salary: number;
  active: boolean;
  created_at: string;
};

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
  "Other",
] as const;
