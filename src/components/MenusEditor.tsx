"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X, Check, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { money, parseMenuItems } from "@/lib/calculations";
import { formatSetting, type AppSetting } from "@/lib/settings";
import { useSession } from "@/components/SessionContext";
import type { Venue, Menu, AddonItem } from "@/types";

/**
 * Menus & Venues, editable in place by the Admin.
 *
 * These figures used to be fixed in the code, so a policy change — KPRA moving
 * from 15% to 13%, a hall charge going up, an item leaving a menu — needed a
 * developer. They now live in the database and the Admin changes them here.
 * NEW booking forms, quotes, agreements and ledger entries pick the new
 * figures up straight away; bookings already saved keep the totals they were
 * agreed at, because changing a rate must not quietly rewrite a signed
 * agreement.
 *
 * Everyone else sees exactly the same screen, minus the edit controls.
 */

const CAN_EDIT_ROLES = ["admin", "developer"];

function slugId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: "text" | "number";
}) {
  return (
    <div>
      <label className="text-[10px] font-bold text-muted uppercase">{label}</label>
      <input
        type={type}
        className="w-full mt-1 text-[13px]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export default function MenusEditor({
  initialMenus,
  initialVenues,
  initialAddons,
  initialSettings,
}: {
  initialMenus: Menu[];
  initialVenues: Venue[];
  initialAddons: AddonItem[];
  initialSettings: AppSetting[];
}) {
  const supabase = createClient();
  const { role } = useSession();
  const canEdit = CAN_EDIT_ROLES.includes(role);

  const [menus, setMenus] = useState(initialMenus);
  const [venues, setVenues] = useState(initialVenues);
  const [addons, setAddons] = useState(initialAddons);
  const [settings, setSettings] = useState(initialSettings);
  const [error, setError] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  // Which row is currently open for editing, keyed by "kind:id".
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<any>({});

  // One search box across the whole page. The add-on list alone runs past a
  // hundred items, so finding "Lamb Roast" or checking what Reception Menu 2
  // includes meant scrolling the lot. Typing narrows menus, venues and items
  // together, and a section with nothing left in it drops out of the way.
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const matches = (...fields: (string | null | undefined)[]) =>
    !q || fields.some((f) => (f || "").toLowerCase().includes(q));

  const reload = useCallback(async () => {
    const [{ data: m }, { data: v }, { data: a }, { data: s }] = await Promise.all([
      supabase.from("menus").select("*").order("name"),
      supabase.from("venues").select("*").order("capacity", { ascending: false }),
      supabase.from("addon_items").select("*").order("sort_order"),
      supabase.from("app_settings").select("*").order("sort_order"),
    ]);
    setMenus((m as Menu[]) || []);
    setVenues((v as Venue[]) || []);
    setAddons((a as AddonItem[]) || []);
    setSettings((s as AppSetting[]) || []);
  }, [supabase]);

  function flashSaved(key: string) {
    setSavedKey(key);
    setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 2000);
  }

  async function run(key: string, fn: () => PromiseLike<{ error: any }>) {
    setError(null);
    const { error: err } = await fn();
    if (err) {
      setError(err.message);
      return false;
    }
    await reload();
    setEditing(null);
    flashSaved(key);
    return true;
  }

  // ---- Menus -------------------------------------------------------------
  async function saveMenu(id: string) {
    await run(`menu:${id}`, () =>
      supabase
        .from("menus")
        .update({ name: draft.name?.trim(), items: draft.items?.trim() })
        .eq("id", id)
    );
  }

  async function addMenu() {
    const id = slugId("m");
    const ok = await run(`menu:${id}`, () =>
      supabase.from("menus").insert({ id, name: "New Menu", rate: 0, items: "" })
    );
    if (ok) {
      setEditing(`menu:${id}`);
      setDraft({ name: "New Menu", items: "" });
    }
  }

  async function deleteMenu(id: string, name: string) {
    if (!confirm(`Remove "${name}"? Bookings already using it keep their agreed rate and items.`)) return;
    await run(`menu:${id}`, () => supabase.from("menus").delete().eq("id", id));
  }

  // ---- Venues ------------------------------------------------------------
  async function saveVenue(id: string) {
    await run(`venue:${id}`, () =>
      supabase
        .from("venues")
        .update({
          name: draft.name?.trim(),
          capacity: Number(draft.capacity) || 0,
          hall_charge: Number(draft.hall_charge) || 0,
          min_waiver: Number(draft.min_waiver) || 0,
          decoration_from: Number(draft.decoration_from) || 0,
        })
        .eq("id", id)
    );
  }

  async function addVenue() {
    const id = slugId("v");
    const ok = await run(`venue:${id}`, () =>
      supabase.from("venues").insert({
        id,
        name: "New Venue",
        capacity: 100,
        hall_charge: 50000,
        min_waiver: 200,
        decoration_from: 60000,
      })
    );
    if (ok) {
      setEditing(`venue:${id}`);
      setDraft({ name: "New Venue", capacity: 100, hall_charge: 50000, min_waiver: 200, decoration_from: 60000 });
    }
  }

  async function deleteVenue(id: string, name: string) {
    if (!confirm(`Remove "${name}"? Existing bookings that used it keep their charges.`)) return;
    await run(`venue:${id}`, () => supabase.from("venues").delete().eq("id", id));
  }

  // ---- Add-on items ------------------------------------------------------
  async function addAddon(category: string) {
    const id = slugId("a");
    const sort = Math.max(0, ...addons.filter((a) => a.category === category).map((a) => a.sort_order)) + 1;
    const ok = await run(`addon:${id}`, () =>
      supabase.from("addon_items").insert({ id, category, name: "New item", price: 0, sort_order: sort })
    );
    if (ok) {
      setEditing(`addon:${id}`);
      setDraft({ name: "New item", price: 0, priced: false, unit_label: "" });
    }
  }

  /**
   * An item is normally covered by the booking's single agreed per-head rate,
   * so it carries no figure of its own. Ticking "charged by the piece" is the
   * exception — Lamb Roast — and then the rate and the unit ("lamb", "leg
   * piece") both matter, because the booking form asks for a count instead of
   * assuming the guest number.
   */
  async function saveAddon(id: string) {
    const priced = Boolean(draft.priced);
    await run(`addon:${id}`, () =>
      supabase
        .from("addon_items")
        .update({
          name: draft.name?.trim(),
          priced,
          price: priced ? Number(draft.price) || 0 : Number(draft.price) || 0,
          unit_label: priced ? (draft.unit_label?.trim() || "piece") : null,
        })
        .eq("id", id)
    );
  }

  async function deleteAddon(id: string, name: string) {
    if (!confirm(`Remove "${name}" from the add-on list?`)) return;
    await run(`addon:${id}`, () => supabase.from("addon_items").delete().eq("id", id));
  }

  // ---- Charge rules ------------------------------------------------------
  async function saveSetting(key: string) {
    const value = Number(draft.value);
    if (!Number.isFinite(value) || value < 0) {
      setError("Enter a number of zero or more.");
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await run(`setting:${key}`, () =>
      supabase
        .from("app_settings")
        .update({ value, updated_by: user?.id, updated_at: new Date().toISOString() })
        .eq("key", key)
    );
  }

  const shownMenus = menus.filter((m) => matches(m.name, m.items));
  const shownVenues = venues.filter((v) => matches(v.name));
  const shownSettings = settings.filter((x) => matches(x.label, x.hint));

  const addonCategories: [string, AddonItem[]][] = [];
  addons.filter((item) => matches(item.name, item.category)).forEach((item) => {
    let bucket = addonCategories.find(([cat]) => cat === item.category);
    if (!bucket) {
      bucket = [item.category, []];
      addonCategories.push(bucket);
    }
    bucket[1].push(item);
  });

  const EditBtn = ({ onClick }: { onClick: () => void }) => (
    <button onClick={onClick} className="text-muted hover:text-primary p-1" title="Edit">
      <Pencil size={13} strokeWidth={2.2} />
    </button>
  );
  const DeleteBtn = ({ onClick }: { onClick: () => void }) => (
    <button onClick={onClick} className="text-muted hover:text-rose p-1" title="Remove">
      <Trash2 size={13} strokeWidth={2.2} />
    </button>
  );
  const RowActions = ({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) => (
    <div className="flex gap-2 justify-end mt-2">
      <button onClick={onCancel} className="btn-ghost rounded-md px-2.5 py-1 text-[11px] flex items-center gap-1">
        <X size={12} /> Cancel
      </button>
      <button onClick={onSave} className="btn-primary rounded-md px-3 py-1 text-[11px] flex items-center gap-1">
        <Check size={12} /> Save
      </button>
    </div>
  );

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div>
          <div className="text-xl font-bold font-serif text-primary">Menus & Venues</div>
          <div className="text-xs text-muted mt-0.5">
            Reception & Mehndi menu packages and venue charges
          </div>
        </div>
      </div>

      {canEdit ? (
        <div className="text-[11.5px] text-[#6B5320] bg-gold-light border border-gold/30 rounded-lg px-3 py-2 my-4">
          You can edit everything on this page. Changes apply to <b>new</b> booking forms, quotations,
          agreements and ledger entries from the moment you save. Bookings already saved keep the figures
          they were agreed at, so a rate change never rewrites a signed agreement.
        </div>
      ) : (
        <div className="text-[11.5px] text-muted bg-bg border border-dashed border-border rounded-lg px-3 py-2 my-4">
          These are the current rates and packages. Only the Admin can change them.
        </div>
      )}

      <div className="relative mb-5">
        <Search
          size={15}
          strokeWidth={2}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
        />
        <input
          className="w-full text-sm pl-9 pr-9"
          placeholder="Search menus, venues, items and charges — e.g. lamb, kheer, diamond, cooling…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-primary p-1"
            title="Clear search"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {q && (
        <div className="text-[11.5px] text-muted mb-4">
          {shownMenus.length} menu{shownMenus.length === 1 ? "" : "s"} · {shownVenues.length} venue
          {shownVenues.length === 1 ? "" : "s"} ·{" "}
          {addonCategories.reduce((n, [, list]) => n + list.length, 0)} item
          {addonCategories.reduce((n, [, list]) => n + list.length, 0) === 1 ? "" : "s"} match.
        </div>
      )}

      {error && (
        <div className="text-[12.5px] font-semibold text-rose bg-rose-light rounded-lg px-3 py-2 mb-4">{error}</div>
      )}

      {/* ---------------- Menus ---------------- */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-[14.5px] font-bold text-primary">Menus</div>
        {canEdit && (
          <button onClick={addMenu} className="btn-ghost rounded-lg px-3 py-1.5 text-[12px] flex items-center gap-1">
            <Plus size={13} /> Add Menu
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {shownMenus.map((m) => {
          const key = `menu:${m.id}`;
          const isEditing = editing === key;
          return (
            <div key={m.id} className="card">
              {isEditing ? (
                <>
                  <Field label="Menu name" value={draft.name ?? ""} onChange={(v) => setDraft({ ...draft, name: v })} />
                  <div className="mt-2">
                    <label className="text-[10px] font-bold text-muted uppercase">
                      Items — separate with commas
                    </label>
                    <textarea
                      className="w-full mt-1 text-[12.5px]"
                      rows={6}
                      value={draft.items ?? ""}
                      onChange={(e) => setDraft({ ...draft, items: e.target.value })}
                    />
                    <div className="text-[10.5px] text-muted mt-1">
                      {parseMenuItems(draft.items || "").length} items. Add or remove them here and every new
                      booking form offers the updated list.
                    </div>
                  </div>
                  <RowActions onSave={() => saveMenu(m.id)} onCancel={() => setEditing(null)} />
                </>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-1">
                    <div className="text-[14.5px] font-bold text-primary mb-2">{m.name}</div>
                    {canEdit && (
                      <div className="flex shrink-0 -mt-1 -mr-1">
                        <EditBtn
                          onClick={() => {
                            setEditing(key);
                            setDraft({ name: m.name, items: m.items });
                          }}
                        />
                        <DeleteBtn onClick={() => deleteMenu(m.id, m.name)} />
                      </div>
                    )}
                  </div>
                  <div className="text-[12.5px]">{m.items || <span className="text-muted">No items yet.</span>}</div>
                  {savedKey === key && <div className="text-[11px] text-gold-deep font-semibold mt-2">Saved.</div>}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* ---------------- Venues ---------------- */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-[14.5px] font-bold text-primary">Venues</div>
        {canEdit && (
          <button onClick={addVenue} className="btn-ghost rounded-lg px-3 py-1.5 text-[12px] flex items-center gap-1">
            <Plus size={13} /> Add Venue
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {shownVenues.map((v) => {
          const key = `venue:${v.id}`;
          const isEditing = editing === key;
          return (
            <div key={v.id} className="card">
              {isEditing ? (
                <>
                  <Field label="Venue name" value={draft.name ?? ""} onChange={(x) => setDraft({ ...draft, name: x })} />
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <Field
                      label="Capacity"
                      type="number"
                      value={draft.capacity ?? 0}
                      onChange={(x) => setDraft({ ...draft, capacity: x })}
                    />
                    <Field
                      label="Hall charge"
                      type="number"
                      value={draft.hall_charge ?? 0}
                      onChange={(x) => setDraft({ ...draft, hall_charge: x })}
                    />
                    <Field
                      label="Waived above (guests)"
                      type="number"
                      value={draft.min_waiver ?? 0}
                      onChange={(x) => setDraft({ ...draft, min_waiver: x })}
                    />
                    <Field
                      label="Decoration from"
                      type="number"
                      value={draft.decoration_from ?? 0}
                      onChange={(x) => setDraft({ ...draft, decoration_from: x })}
                    />
                  </div>
                  <RowActions onSave={() => saveVenue(v.id)} onCancel={() => setEditing(null)} />
                </>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-1">
                    <div className="text-[14.5px] font-bold text-primary mb-2">{v.name}</div>
                    {canEdit && (
                      <div className="flex shrink-0 -mt-1 -mr-1">
                        <EditBtn
                          onClick={() => {
                            setEditing(key);
                            setDraft({ ...v });
                          }}
                        />
                        <DeleteBtn onClick={() => deleteVenue(v.id, v.name)} />
                      </div>
                    )}
                  </div>
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
                  {savedKey === key && <div className="text-[11px] text-gold-deep font-semibold mt-2">Saved.</div>}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* ---------------- Add-ons ---------------- */}
      <div className="text-[14.5px] font-bold text-primary mb-1">Add-Ons</div>
      <div className="text-xs text-muted mb-3">
        Available for the Customized Menu, or as extras added on top of any regular menu when booking.
        Almost everything here carries no rate of its own — the booking&apos;s single agreed per-head figure
        covers it. Lamb Roast is the exception: it is charged by the piece, at the rate shown, on top of
        that per-head figure.
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {addonCategories.map(([category, catItems]) => (
          <div key={category} className="card">
            <div className="flex items-center justify-between mb-2.5">
              <div className="text-[13.5px] font-bold text-primary">{category}</div>
              {canEdit && (
                <button
                  onClick={() => addAddon(category)}
                  className="text-muted hover:text-primary p-1"
                  title={`Add an item to ${category}`}
                >
                  <Plus size={13} strokeWidth={2.4} />
                </button>
              )}
            </div>
            <table className="w-full text-[12.5px]">
              <tbody>
                {catItems.map((item) => {
                  const key = `addon:${item.id}`;
                  return (
                    <tr key={item.id} className="border-b border-border last:border-0">
                      <td className="py-1.5 pr-2">
                        {editing === key ? (
                          <div className="py-1">
                            <div className="flex gap-1.5 items-center">
                              <input
                                className="flex-1 text-[12.5px]"
                                value={draft.name ?? ""}
                                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                                onKeyDown={(e) => e.key === "Enter" && saveAddon(item.id)}
                                autoFocus
                              />
                              <button onClick={() => saveAddon(item.id)} className="text-gold-deep p-1">
                                <Check size={14} />
                              </button>
                              <button onClick={() => setEditing(null)} className="text-muted p-1">
                                <X size={14} />
                              </button>
                            </div>
                            <label className="flex items-center gap-1.5 text-[11px] text-muted mt-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(draft.priced)}
                                onChange={(e) => setDraft({ ...draft, priced: e.target.checked })}
                              />
                              Charged by the piece, on top of the per-head rate
                            </label>
                            {draft.priced && (
                              <div className="flex gap-1.5 mt-1.5">
                                <input
                                  type="number"
                                  className="w-24 text-[12px]"
                                  placeholder="Rate"
                                  value={draft.price ?? 0}
                                  onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                                />
                                <input
                                  className="flex-1 text-[12px]"
                                  placeholder="per what? e.g. lamb, leg piece"
                                  value={draft.unit_label ?? ""}
                                  onChange={(e) => setDraft({ ...draft, unit_label: e.target.value })}
                                />
                              </div>
                            )}
                          </div>
                        ) : (
                          <>
                            {item.name}
                            {item.priced && Number(item.price) > 0 && (
                              <span className="block text-[11px] font-semibold text-gold-deep">
                                {money(item.price)} per {item.unit_label || "piece"}
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      {canEdit && editing !== key && (
                        <td className="py-1.5 text-right whitespace-nowrap">
                          <EditBtn
                            onClick={() => {
                              setEditing(key);
                              setDraft({ name: item.name });
                            }}
                          />
                          <DeleteBtn onClick={() => deleteAddon(item.id, item.name)} />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* ---------------- Charge rules ---------------- */}
      <div className="card">
        <div className="text-[14.5px] font-bold text-primary mb-1">Other Charges (owner rules)</div>
        <div className="text-xs text-muted mb-3">
          {canEdit
            ? "Change a figure here and every new booking form, quotation, agreement and ledger entry uses it from that moment on."
            : "The charges applied to every new booking."}
        </div>
        <table className="w-full text-[13px]">
          <tbody>
            {shownSettings.map((s) => {
              const key = `setting:${s.key}`;
              const isEditing = editing === key;
              return (
                <tr key={s.key} className="border-b border-border last:border-0">
                  <td className="py-2 pr-3">
                    {s.label}
                    {s.hint && <div className="text-[11px] text-muted mt-0.5">{s.hint}</div>}
                  </td>
                  <td className="text-right py-2 whitespace-nowrap">
                    {isEditing ? (
                      <div className="flex gap-1.5 items-center justify-end">
                        <input
                          type="number"
                          className="w-28 text-[13px] text-right"
                          value={draft.value ?? ""}
                          onChange={(e) => setDraft({ value: e.target.value })}
                          onKeyDown={(e) => e.key === "Enter" && saveSetting(s.key)}
                          autoFocus
                        />
                        <span className="text-[11px] text-muted w-10 text-left">
                          {s.unit === "percent" ? "%" : s.unit === "rs_per_hour" ? "/ hr" : s.unit === "rs_per_head" ? "/ head" : "Rs."}
                        </span>
                        <button onClick={() => saveSetting(s.key)} className="text-gold-deep p-1">
                          <Check size={14} />
                        </button>
                        <button onClick={() => setEditing(null)} className="text-muted p-1">
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        <span className="font-bold">{formatSetting(s)}</span>
                        {savedKey === key && (
                          <span className="text-[11px] text-gold-deep font-semibold ml-1">Saved</span>
                        )}
                        {canEdit && (
                          <EditBtn
                            onClick={() => {
                              setEditing(key);
                              setDraft({ value: s.value });
                            }}
                          />
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {settings.length === 0 && (
          <div className="text-[12.5px] text-muted py-3">
            Charge rules haven't been set up yet — run the latest database migration to create them.
          </div>
        )}
      </div>
    </div>
  );
}
