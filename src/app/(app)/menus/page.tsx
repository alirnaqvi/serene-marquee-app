import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/calculations";
import { KPR_RATE, COOLING_CHARGE_PER_HALL, HEATER_CHARGE, TOKEN_MINIMUM, EXTRA_HOUR_CHARGE } from "@/lib/constants";
import type { AddonItem } from "@/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MenusPage() {
  const supabase = createClient();
  const [{ data: menus }, { data: venues }, { data: addonItems }] = await Promise.all([
    supabase.from("menus").select("*").order("rate"),
    supabase.from("venues").select("*").order("capacity", { ascending: false }),
    supabase.from("addon_items").select("*").order("sort_order"),
  ]);

  const addonCategories: [string, AddonItem[]][] = [];
  (addonItems || []).forEach((item) => {
    let bucket = addonCategories.find(([cat]) => cat === item.category);
    if (!bucket) {
      bucket = [item.category, []];
      addonCategories.push(bucket);
    }
    bucket[1].push(item);
  });

  return (
    <div>
      <div className="text-xl font-bold font-serif text-primary mb-1">Menus & Venues</div>
      <div className="text-xs text-muted mb-5">Reception & Mehndi menu rates and venue charges</div>

      <div className="text-[14.5px] font-bold text-primary mb-3">Menus</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {(menus || []).map((m) => (
          <div key={m.id} className="card">
            <div className="text-[14.5px] font-bold text-primary mb-2">{m.name}</div>
            <div className="text-xl font-bold font-serif">
              {money(m.rate)} <span className="text-xs text-muted font-normal">/ head</span>
            </div>
            <div className="text-[11.5px] text-muted mb-2">+{KPR_RATE * 100}% KPRA tax</div>
            <div className="text-[12.5px]">{m.items}</div>
          </div>
        ))}
      </div>

      <div className="text-[14.5px] font-bold text-primary mb-3">Venues</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {(venues || []).map((v) => (
          <div key={v.id} className="card">
            <div className="text-[14.5px] font-bold text-primary mb-2">{v.name}</div>
            <table className="w-full text-[13px]">
              <tbody>
                <tr>
                  <td className="text-muted py-1">Capacity</td>
                  <td className="text-right font-bold py-1">{v.capacity} persons</td>
                </tr>
                <tr>
                  <td className="text-muted py-1">Hall Charge</td>
                  <td className="text-right font-bold py-1">{money(v.hall_charge)}</td>
                </tr>
                <tr>
                  <td className="text-muted py-1">Waived above</td>
                  <td className="text-right font-bold py-1">{v.min_waiver} guests</td>
                </tr>
                <tr>
                  <td className="text-muted py-1">Decoration from</td>
                  <td className="text-right font-bold py-1">{money(v.decoration_from)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div className="text-[14.5px] font-bold text-primary mb-1">Add-Ons</div>
      <div className="text-xs text-muted mb-3">
        Available for the Customized Menu, or as extras added on top of any regular menu when booking. Every
        item is charged <b className="text-primary">per head</b> — quantity always follows the guaranteed guest
        count.
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {addonCategories.map(([category, catItems]) => (
          <div key={category} className="card">
            <div className="text-[13.5px] font-bold text-primary mb-2.5">{category}</div>
            <table className="w-full text-[12.5px]">
              <tbody>
                {catItems.map((item) => (
                  <tr key={item.id} className="border-b border-border last:border-0">
                    <td className="py-1.5 pr-2">{item.name}</td>
                    <td className="py-1.5 text-right font-semibold whitespace-nowrap">
                      {money(item.price)}
                      <span className="text-muted font-normal"> / head</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="text-[14.5px] font-bold text-primary mb-3">Other Charges (owner rules)</div>
        <table className="w-full text-[13px]">
          <tbody>
            <tr className="border-b border-border">
              <td className="py-2">KPRA Tax on food</td>
              <td className="text-right font-bold py-2">{KPR_RATE * 100}%</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2">Income Tax (Filer)</td>
              <td className="text-right font-bold py-2">10% of total</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2">Income Tax (Non-Filer)</td>
              <td className="text-right font-bold py-2">20% of total</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2">Cooling (per hall)</td>
              <td className="text-right font-bold py-2">{money(COOLING_CHARGE_PER_HALL)}</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2">Heating (per heater)</td>
              <td className="text-right font-bold py-2">{money(HEATER_CHARGE)}</td>
            </tr>
            <tr className="border-b border-border">
              <td className="py-2">Token to confirm booking (non-refundable)</td>
              <td className="text-right font-bold py-2">{money(TOKEN_MINIMUM)}</td>
            </tr>
            <tr>
              <td className="py-2">Extra hour beyond the 4-hour slot</td>
              <td className="text-right font-bold py-2">{money(EXTRA_HOUR_CHARGE)} / hr</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
