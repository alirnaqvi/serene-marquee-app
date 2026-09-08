import { createClient } from "@/lib/supabase/server";
import MenusEditor from "@/components/MenusEditor";
import type { AppSetting } from "@/lib/settings";
import type { AddonItem, Menu, Venue } from "@/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Menus, venues, add-ons and the owner's charge rules — read by everyone,
 * edited by the Admin. All four now come from the database rather than from
 * constants in the code, so a policy change (KPRA 15% -> 13%, a new hall, an
 * item dropped from a menu) is made here and flows into every new booking.
 */
export default async function MenusPage() {
  const supabase = createClient();
  const [{ data: menus }, { data: venues }, { data: addonItems }, { data: settings }] = await Promise.all([
    supabase.from("menus").select("*").order("name"),
    supabase.from("venues").select("*").order("capacity", { ascending: false }),
    supabase.from("addon_items").select("*").order("sort_order"),
    supabase.from("app_settings").select("*").order("sort_order"),
  ]);

  return (
    <MenusEditor
      initialMenus={(menus as Menu[]) || []}
      initialVenues={(venues as Venue[]) || []}
      initialAddons={(addonItems as AddonItem[]) || []}
      initialSettings={(settings as AppSetting[]) || []}
    />
  );
}
