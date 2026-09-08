import {
  KPR_RATE,
  COOLING_CHARGE_PER_HALL,
  HEATER_CHARGE,
  TOKEN_MINIMUM,
  EXTRA_HOUR_CHARGE,
  CONFIRMATION_MINIMUM,
  ENTRY_TEST_RATE,
} from "./constants";

/**
 * The owner's charge rules used to be constants in the code, which meant a
 * policy change — KPRA moving from 15% to 13%, say — needed a developer. They
 * now live in the `app_settings` table and the Admin edits them on the
 * Menus & Venues screen. Every new booking form, quote and agreement reads the
 * current figures; bookings already saved keep the totals they were agreed at.
 *
 * The constants remain as the fallback, so the app still calculates correctly
 * if the settings row hasn't loaded yet or the migration hasn't been run.
 */
export type SettingUnit = "rs" | "percent" | "rs_per_hour" | "rs_per_head";

export type AppSetting = {
  key: string;
  label: string;
  value: number;
  unit: SettingUnit;
  hint: string | null;
  sort_order: number;
  updated_at?: string;
};

export type ChargeSettings = {
  /** As a fraction — 0.15 for 15%. Stored in the table as the percentage. */
  kpraRate: number;
  coolingCharge: number;
  heaterCharge: number;
  tokenMinimum: number;
  extraHour: number;
  confirmationMinimum: number;
  entryTestRate: number;
};

export const DEFAULT_SETTINGS: ChargeSettings = {
  kpraRate: KPR_RATE,
  coolingCharge: COOLING_CHARGE_PER_HALL,
  heaterCharge: HEATER_CHARGE,
  tokenMinimum: TOKEN_MINIMUM,
  extraHour: EXTRA_HOUR_CHARGE,
  confirmationMinimum: CONFIRMATION_MINIMUM,
  entryTestRate: ENTRY_TEST_RATE,
};

const KEYS = {
  kpra_rate: "kpraRate",
  cooling_charge: "coolingCharge",
  heater_charge: "heaterCharge",
  token_minimum: "tokenMinimum",
  extra_hour: "extraHour",
  confirmation_min: "confirmationMinimum",
  entry_test_rate: "entryTestRate",
} as const;

/** Turn the raw `app_settings` rows into the shape the calculator wants. */
export function settingsFromRows(rows: AppSetting[] | null | undefined): ChargeSettings {
  const out: ChargeSettings = { ...DEFAULT_SETTINGS };
  (rows || []).forEach((row) => {
    const field = (KEYS as Record<string, keyof ChargeSettings>)[row.key];
    if (!field) return;
    const raw = Number(row.value);
    if (!Number.isFinite(raw)) return;
    // The tax is entered and displayed as a percentage but used as a fraction.
    out[field] = field === "kpraRate" ? raw / 100 : raw;
  });
  return out;
}

/** Works with either the browser or the server Supabase client. */
export async function fetchSettings(supabase: any): Promise<ChargeSettings> {
  const { data } = await supabase.from("app_settings").select("*");
  return settingsFromRows(data as AppSetting[]);
}

export async function fetchSettingRows(supabase: any): Promise<AppSetting[]> {
  const { data } = await supabase.from("app_settings").select("*").order("sort_order");
  return (data as AppSetting[]) || [];
}

export function formatSetting(s: Pick<AppSetting, "value" | "unit">): string {
  const v = Number(s.value) || 0;
  switch (s.unit) {
    case "percent":
      return `${v}%`;
    case "rs_per_hour":
      return `Rs. ${v.toLocaleString("en-PK")} / hr`;
    case "rs_per_head":
      return `Rs. ${v.toLocaleString("en-PK")} / head`;
    default:
      return `Rs. ${v.toLocaleString("en-PK")}`;
  }
}
