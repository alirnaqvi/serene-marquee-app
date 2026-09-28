"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Trash2, X, Check, Search, ArrowUp, ArrowDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { money, parseMenuItems } from "@/lib/calculations";
import { formatSetting, type AppSetting } from "@/lib/settings";
import { useSession } from "@/components/SessionContext";
import AlertModal from "@/components/AlertModal";
import type { Venue, Menu, AddonItem } from "@/types";

/**
 * Menus & Venues — read by everyone, edited by the Admin.
 *
 * Editing used to happen inside the small cards themselves: a menu's items
 * were one long comma-separated textbox, "Add" created a placeholder row in
 * the database before anything was typed, deletes went through the browser's
 * bare confirm(), and opening an add-on for editing loaded only its name — so
 * saving a rename on Lamb Roast silently switched off its per-piece rate.
 *
 * Now each thing opens in its own editor with every field loaded, items are a
 * proper list (add, reorder, rename, remove one at a time), nothing is written
 * until Save, and the page is split into tabs so the hundred-odd add-ons
 * aren't in the way of the four menus.
 */

const CAN_EDIT_ROLES = ["admin", "developer"];
type Tab = "menus" | "venues" | "addons" | "charges";

function slugId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
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
  const [tab, setTab] = useState<Tab>("menus");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  // Which editor is open. `null` id = adding a new one.
  const [menuEdit, setMenuEdit] = useState<Menu | "new" | null>(null);
  const [venueEdit, setVenueEdit] = useState<Venue | "new" | null>(null);
  const [addonEdit, setAddonEdit] = useState<{ item: AddonItem | null; category: string } | null>(null);
  const [deleting, setDeleting] = useState<{ what: string; message: string; run: () => Promise<void> } | null>(null);
  const [settingEdit, setSettingEdit] = useState<{ key: string; value: string } | null>(null);

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

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast((t) => (t === message ? null : t)), 2400);
  }

  const shownMenus = menus.filter((m) => matches(m.name, m.items));
  const shownVenues = venues.filter((v) => matches(v.name));
  const shownAddons = addons.filter((a) => matches(a.name, a.category));
  const shownSettings = settings.filter((x) => matches(x.label, x.hint));
  const categories = useMemo(() => Array.from(new Set(addons.map((a) => a.category))), [addons]);

  const addonGroups: [string, AddonItem[]][] = [];
  shownAddons.forEach((item) => {
    let bucket = addonGroups.find(([c]) => c === item.category);
    if (!bucket) addonGroups.push((bucket = [item.category, []]));
    bucket[1].push(item);
  });

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "menus", label: "Menus", count: shownMenus.length },
    { id: "venues", label: "Venues", count: shownVenues.length },
    { id: "addons", label: "Add-ons", count: shownAddons.length },
    { id: "charges", label: "Other charges", count: shownSettings.length },
  ];

  // Searching jumps to the first tab that has anything to show.
  useEffect(() => {
    if (!q) return;
    const current = tabs.find((t) => t.id === tab);
    if (current && current.count > 0) return;
    const first = tabs.find((t) => t.count > 0);
    if (first) setTab(first.id);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveSetting(key: string, raw: string) {
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value) || value < 0) {
      setPageError("Enter a number of zero or more.");
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("app_settings")
      .update({ value, updated_by: user?.id, updated_at: new Date().toISOString() })
      .eq("key", key);
    if (error) return setPageError(error.message);
    setPageError(null);
    setSettingEdit(null);
    await reload();
    flash("Charge updated");
  }

  const IconBtn = ({
    onClick,
    title,
    danger,
    children,
  }: {
    onClick: () => void;
    title: string;
    danger?: boolean;
    children: React.ReactNode;
  }) => (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`p-1.5 rounded-md text-muted ${danger ? "hover:text-rose hover:bg-rose-light" : "hover:text-primary hover:bg-bg"}`}
    >
      {children}
    </button>
  );

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div>
          <div className="text-xl font-bold font-serif text-primary">Menus & Venues</div>
          <div className="text-xs text-muted mt-0.5">Menu packages, halls, add-on items and the owner's charges</div>
        </div>
      </div>

      <div
        className={`text-[11.5px] rounded-lg px-3 py-2 my-4 ${
          canEdit
            ? "text-[#6B5320] bg-gold-light border border-gold/30"
            : "text-muted bg-bg border border-dashed border-border"
        }`}
      >
        {canEdit
          ? "Changes apply to new booking forms, quotations and agreements from the moment you save. Bookings already saved keep the figures they were agreed at."
          : "These are the current rates and packages. Only the Admin can change them."}
      </div>

      <div className="relative mb-3">
        <Search size={15} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
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
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="flex gap-1 border-b border-border mb-5 overflow-x-auto" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap border-b-2 -mb-px ${
              tab === t.id ? "border-gold text-primary" : "border-transparent text-muted hover:text-primary"
            }`}
          >
            {t.label} <span className="text-[11px] font-normal text-muted">({t.count})</span>
          </button>
        ))}
      </div>

      {pageError && (
        <div className="text-[12.5px] font-semibold text-rose bg-rose-light rounded-lg px-3 py-2 mb-4">{pageError}</div>
      )}

      {/* ---------------- Menus ---------------- */}
      {tab === "menus" && (
        <>
          {canEdit && (
            <div className="flex justify-end mb-3">
              <button onClick={() => setMenuEdit("new")} className="btn-primary rounded-lg px-3.5 py-2 text-[12.5px] flex items-center gap-1">
                <Plus size={14} /> Add menu
              </button>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {shownMenus.map((m) => {
              const items = parseMenuItems(m.items);
              return (
                <div key={m.id} className="card">
                  <div className="flex items-start justify-between gap-2 mb-2.5">
                    <div>
                      <div className="text-[15px] font-bold text-primary">{m.name}</div>
                      <div className="text-[11px] text-muted">{items.length} items</div>
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 -mt-1 -mr-1">
                        <IconBtn onClick={() => setMenuEdit(m)} title={`Edit ${m.name}`}>
                          <Pencil size={14} strokeWidth={2.2} />
                        </IconBtn>
                        <IconBtn
                          danger
                          title={`Remove ${m.name}`}
                          onClick={() =>
                            setDeleting({
                              what: m.name,
                              message: `"${m.name}" will no longer be offered on new booking forms. Bookings already using it keep their agreed rate and items.`,
                              run: async () => {
                                const { error } = await supabase.from("menus").delete().eq("id", m.id);
                                if (error) throw error;
                              },
                            })
                          }
                        >
                          <Trash2 size={14} strokeWidth={2.2} />
                        </IconBtn>
                      </div>
                    )}
                  </div>
                  {items.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {items.map((it) => (
                        <span key={it} className="rounded-full border border-border bg-bg px-2.5 py-0.5 text-[12px]">
                          {it}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[12.5px] text-muted">No items yet.</div>
                  )}
                </div>
              );
            })}
          </div>
          {shownMenus.length === 0 && <Empty q={q} what="menus" />}
        </>
      )}

      {/* ---------------- Venues ---------------- */}
      {tab === "venues" && (
        <>
          {canEdit && (
            <div className="flex justify-end mb-3">
              <button onClick={() => setVenueEdit("new")} className="btn-primary rounded-lg px-3.5 py-2 text-[12.5px] flex items-center gap-1">
                <Plus size={14} /> Add venue
              </button>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {shownVenues.map((v) => (
              <div key={v.id} className="card">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="text-[15px] font-bold text-primary">{v.name}</div>
                  {canEdit && (
                    <div className="flex shrink-0 -mt-1 -mr-1">
                      <IconBtn onClick={() => setVenueEdit(v)} title={`Edit ${v.name}`}>
                        <Pencil size={14} strokeWidth={2.2} />
                      </IconBtn>
                      <IconBtn
                        danger
                        title={`Remove ${v.name}`}
                        onClick={() =>
                          setDeleting({
                            what: v.name,
                            message: `"${v.name}" will no longer be offered on new booking forms. Existing bookings that used it keep their charges.`,
                            run: async () => {
                              const { error } = await supabase.from("venues").delete().eq("id", v.id);
                              if (error) throw error;
                            },
                          })
                        }
                      >
                        <Trash2 size={14} strokeWidth={2.2} />
                      </IconBtn>
                    </div>
                  )}
                </div>
                <dl className="text-[13px] divide-y divide-border">
                  <Stat k="Capacity" v={`${v.capacity} guests`} />
                  <Stat k="Hall charge" v={money(v.hall_charge)} />
                  <Stat k="Hall charge waived at" v={`${v.min_waiver}+ guests`} />
                  <Stat k="Decoration from" v={money(v.decoration_from)} />
                </dl>
              </div>
            ))}
          </div>
          {shownVenues.length === 0 && <Empty q={q} what="venues" />}
        </>
      )}

      {/* ---------------- Add-ons ---------------- */}
      {tab === "addons" && (
        <>
          <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
            <div className="text-xs text-muted max-w-2xl">
              Items for the Customized Menu, or extras on top of a regular menu. Most are covered by the booking's
              per-head rate. Items marked with a rate — like Lamb Roast — are charged by the piece on top.
            </div>
            {canEdit && (
              <button
                onClick={() => setAddonEdit({ item: null, category: categories[0] || "" })}
                className="btn-primary rounded-lg px-3.5 py-2 text-[12.5px] flex items-center gap-1"
              >
                <Plus size={14} /> Add item
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {addonGroups.map(([category, items]) => (
              <div key={category} className="card">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[13.5px] font-bold text-primary">
                    {category} <span className="text-[11px] font-normal text-muted">({items.length})</span>
                  </div>
                  {canEdit && (
                    <IconBtn onClick={() => setAddonEdit({ item: null, category })} title={`Add an item to ${category}`}>
                      <Plus size={14} strokeWidth={2.4} />
                    </IconBtn>
                  )}
                </div>
                <ul className="text-[12.5px] divide-y divide-border">
                  {items.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-2 py-1.5 group">
                      <div className="min-w-0">
                        {item.name}
                        {item.priced && Number(item.price) > 0 && (
                          <span className="block text-[11px] font-semibold text-gold-deep">
                            {money(item.price)} per {item.unit_label || "piece"}
                          </span>
                        )}
                      </div>
                      {canEdit && (
                        <div className="flex shrink-0 opacity-70 group-hover:opacity-100">
                          <IconBtn onClick={() => setAddonEdit({ item, category: item.category })} title={`Edit ${item.name}`}>
                            <Pencil size={13} strokeWidth={2.2} />
                          </IconBtn>
                          <IconBtn
                            danger
                            title={`Remove ${item.name}`}
                            onClick={() =>
                              setDeleting({
                                what: item.name,
                                message: `"${item.name}" will be removed from the add-on list. Bookings that already include it keep it.`,
                                run: async () => {
                                  const { error } = await supabase.from("addon_items").delete().eq("id", item.id);
                                  if (error) throw error;
                                },
                              })
                            }
                          >
                            <Trash2 size={13} strokeWidth={2.2} />
                          </IconBtn>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {addonGroups.length === 0 && <Empty q={q} what="items" />}
        </>
      )}

      {/* ---------------- Charge rules ---------------- */}
      {tab === "charges" && (
        <div className="card max-w-3xl">
          <div className="text-xs text-muted mb-3">
            {canEdit
              ? "Click Edit, type the new figure and press Enter. New booking forms, quotations and agreements use it straight away."
              : "The charges applied to every new booking."}
          </div>
          <ul className="divide-y divide-border text-[13px]">
            {shownSettings.map((s) => {
              const editingThis = settingEdit?.key === s.key;
              return (
                <li key={s.key} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="font-semibold">{s.label}</div>
                    {s.hint && <div className="text-[11px] text-muted mt-0.5">{s.hint}</div>}
                  </div>
                  {editingThis ? (
                    <div className="flex gap-1.5 items-center shrink-0">
                      <input
                        type="number"
                        className="w-28 text-[13px] text-right"
                        value={settingEdit.value}
                        onChange={(e) => setSettingEdit({ key: s.key, value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveSetting(s.key, settingEdit.value);
                          if (e.key === "Escape") setSettingEdit(null);
                        }}
                        autoFocus
                        aria-label={s.label}
                      />
                      <span className="text-[11px] text-muted w-10">
                        {s.unit === "percent" ? "%" : s.unit === "rs_per_hour" ? "Rs / hr" : s.unit === "rs_per_head" ? "Rs / head" : "Rs."}
                      </span>
                      <button onClick={() => saveSetting(s.key, settingEdit.value)} className="btn-primary rounded-md px-2.5 py-1 text-[11px]">
                        Save
                      </button>
                      <button onClick={() => setSettingEdit(null)} className="btn-ghost rounded-md px-2.5 py-1 text-[11px]">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-bold">{formatSetting(s)}</span>
                      {canEdit && (
                        <button
                          onClick={() => setSettingEdit({ key: s.key, value: String(s.value) })}
                          className="btn-ghost rounded-md px-2.5 py-1 text-[11px]"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {settings.length === 0 && (
            <div className="text-[12.5px] text-muted py-3">
              Charge rules haven't been set up yet — run the latest database migration to create them.
            </div>
          )}
        </div>
      )}

      {/* ---------------- Editors ---------------- */}
      {menuEdit && (
        <MenuEditorModal
          menu={menuEdit === "new" ? null : menuEdit}
          onClose={() => setMenuEdit(null)}
          onSave={async (name, items) => {
            const payload = { name, items: items.join(", ") };
            const { error } =
              menuEdit === "new"
                ? await supabase.from("menus").insert({ id: slugId("m"), rate: 0, ...payload })
                : await supabase.from("menus").update(payload).eq("id", menuEdit.id);
            if (error) return error.message;
            await reload();
            setMenuEdit(null);
            flash(`${name} saved`);
            return null;
          }}
        />
      )}

      {venueEdit && (
        <VenueEditorModal
          venue={venueEdit === "new" ? null : venueEdit}
          onClose={() => setVenueEdit(null)}
          onSave={async (row) => {
            const { error } =
              venueEdit === "new"
                ? await supabase.from("venues").insert({ id: slugId("v"), ...row })
                : await supabase.from("venues").update(row).eq("id", venueEdit.id);
            if (error) return error.message;
            await reload();
            setVenueEdit(null);
            flash(`${row.name} saved`);
            return null;
          }}
        />
      )}

      {addonEdit && (
        <AddonEditorModal
          item={addonEdit.item}
          defaultCategory={addonEdit.category}
          categories={categories}
          onClose={() => setAddonEdit(null)}
          onSave={async (row) => {
            let error;
            if (addonEdit.item) {
              ({ error } = await supabase.from("addon_items").update(row).eq("id", addonEdit.item.id));
            } else {
              const sort = Math.max(0, ...addons.filter((a) => a.category === row.category).map((a) => a.sort_order)) + 1;
              ({ error } = await supabase.from("addon_items").insert({ id: slugId("a"), sort_order: sort, ...row }));
            }
            if (error) return error.message;
            await reload();
            setAddonEdit(null);
            flash(`${row.name} saved`);
            return null;
          }}
        />
      )}

      {deleting && (
        <AlertModal
          title={`Remove ${deleting.what}?`}
          message={deleting.message}
          tone="danger"
          confirmLabel="Remove"
          onConfirm={async () => {
            try {
              await deleting.run();
              await reload();
              flash(`${deleting.what} removed`);
            } catch (e: any) {
              setPageError(e?.message || "Couldn't remove that.");
            }
            setDeleting(null);
          }}
          onClose={() => setDeleting(null)}
        />
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[70] bg-primary text-white text-[12.5px] font-semibold rounded-lg px-4 py-2.5 shadow-lg flex items-center gap-2"
        >
          <Check size={14} className="text-gold" /> {toast}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Shared modal shell
// ===========================================================================
function EditorShell({
  title,
  subtitle,
  dirty,
  error,
  saving,
  saveLabel = "Save",
  onClose,
  onSave,
  children,
}: {
  title: string;
  subtitle?: string;
  dirty: boolean;
  error: string | null;
  saving: boolean;
  saveLabel?: string;
  onClose: () => void;
  onSave: () => void;
  children: React.ReactNode;
}) {
  const [confirmLeave, setConfirmLeave] = useState(false);
  const tryClose = () => (dirty ? setConfirmLeave(true) : onClose());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") tryClose();
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        onSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      onClick={(e) => e.target === e.currentTarget && tryClose()}
    >
      <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl my-8 flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
          <div>
            <div className="font-bold text-[15px] text-primary">{title}</div>
            {subtitle && <div className="text-xs text-muted mt-0.5">{subtitle}</div>}
          </div>
          <button onClick={tryClose} className="text-muted hover:text-primary p-1" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>
        {error && <div className="px-5 pb-2 text-rose text-[12.5px] font-semibold">{error}</div>}
        <div className="px-5 py-3.5 border-t border-border flex items-center justify-end gap-2">
          <span className="text-[11px] text-muted mr-auto hidden sm:inline">{dirty ? "Unsaved changes" : ""}</span>
          <button onClick={tryClose} className="btn-ghost rounded-lg px-4 py-2 text-sm">
            Cancel
          </button>
          <button onClick={onSave} disabled={saving || !dirty} className="btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-40">
            {saving ? "Saving…" : saveLabel}
          </button>
        </div>
      </div>
      {confirmLeave && (
        <AlertModal
          title="Discard your changes?"
          message="What you've typed here hasn't been saved."
          tone="danger"
          confirmLabel="Discard"
          onConfirm={onClose}
          onClose={() => setConfirmLeave(false)}
        />
      )}
    </div>
  );
}

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <>
      <label className="text-xs font-bold text-muted uppercase">{children}</label>
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </>
  );
}

// ===========================================================================
// Menu
// ===========================================================================
function MenuEditorModal({
  menu,
  onClose,
  onSave,
}: {
  menu: Menu | null;
  onClose: () => void;
  onSave: (name: string, items: string[]) => Promise<string | null>;
}) {
  const startItems = menu ? parseMenuItems(menu.items) : [];
  const [name, setName] = useState(menu?.name || "");
  const [items, setItems] = useState<string[]>(startItems);
  const [newItem, setNewItem] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const newRef = useRef<HTMLInputElement>(null);

  const dirty = name !== (menu?.name || "") || items.join("\u0000") !== startItems.join("\u0000") || newItem.trim() !== "";

  // Typing "Kheer, Fruit Trifle" or pasting a whole list adds each one.
  function addFrom(text: string) {
    const parts = text
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((p) => !items.some((i) => i.toLowerCase() === p.toLowerCase()));
    if (parts.length) setItems((prev) => [...prev, ...parts]);
    setNewItem("");
    newRef.current?.focus();
  }
  function move(i: number, dir: -1 | 1) {
    setItems((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function save() {
    const finalItems = [...items, ...newItem.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)]
      .map((s) => s.replace(/,/g, " ").trim())
      .filter(Boolean);
    if (!name.trim()) return setError("Give the menu a name.");
    if (finalItems.length === 0) return setError("Add at least one item.");
    setSaving(true);
    const err = await onSave(name.trim(), finalItems);
    setSaving(false);
    if (err) setError(err);
  }

  return (
    <EditorShell
      title={menu ? `Edit ${menu.name}` : "New menu"}
      subtitle="Items are shown on the booking form, quotation and agreement in this order."
      dirty={dirty}
      error={error}
      saving={saving}
      saveLabel={menu ? "Save menu" : "Add menu"}
      onClose={onClose}
      onSave={save}
    >
      <Label>Menu name</Label>
      <input className="w-full mt-1 mb-4" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Reception Menu 4" autoFocus={!menu} />

      <Label>Items ({items.length})</Label>
      <ul className="mt-1.5 border border-border rounded-lg divide-y divide-border">
        {items.length === 0 && <li className="px-3 py-3 text-[12.5px] text-muted">No items yet — add them below.</li>}
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1 px-1.5 py-1">
            <input
              className="flex-1 min-w-0 text-[13px] border-transparent bg-transparent hover:border-border focus:bg-white px-2 py-1.5"
              value={it}
              onChange={(e) => setItems((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
              aria-label={`Item ${i + 1}`}
            />
            <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1 text-muted hover:text-primary disabled:opacity-25" aria-label="Move up">
              <ArrowUp size={14} />
            </button>
            <button
              onClick={() => move(i, 1)}
              disabled={i === items.length - 1}
              className="p-1 text-muted hover:text-primary disabled:opacity-25"
              aria-label="Move down"
            >
              <ArrowDown size={14} />
            </button>
            <button
              onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}
              className="p-1 text-muted hover:text-rose"
              aria-label={`Remove ${it}`}
            >
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2 mt-2">
        <input
          ref={newRef}
          className="flex-1 text-[13px]"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addFrom(newItem);
            }
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (/[,\n]/.test(text)) {
              e.preventDefault();
              addFrom(text);
            }
          }}
          placeholder="Type an item and press Enter"
          autoFocus={!!menu}
        />
        <button onClick={() => addFrom(newItem)} disabled={!newItem.trim()} className="btn-ghost rounded-lg px-3 py-2 text-[12.5px] disabled:opacity-40">
          Add
        </button>
      </div>
      <div className="text-[11px] text-muted mt-1.5">Pasting a comma-separated list adds every item at once.</div>
    </EditorShell>
  );
}

// ===========================================================================
// Venue
// ===========================================================================
function VenueEditorModal({
  venue,
  onClose,
  onSave,
}: {
  venue: Venue | null;
  onClose: () => void;
  onSave: (row: Omit<Venue, "id">) => Promise<string | null>;
}) {
  const start = {
    name: venue?.name || "",
    capacity: String(venue?.capacity ?? 300),
    hall_charge: String(venue?.hall_charge ?? 50000),
    min_waiver: String(venue?.min_waiver ?? 200),
    decoration_from: String(venue?.decoration_from ?? 60000),
  };
  const [f, setF] = useState(start);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(f) !== JSON.stringify(start);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function save() {
    const row = {
      name: f.name.trim(),
      capacity: Number(f.capacity) || 0,
      hall_charge: Number(f.hall_charge) || 0,
      min_waiver: Number(f.min_waiver) || 0,
      decoration_from: Number(f.decoration_from) || 0,
    };
    if (!row.name) return setError("Give the venue a name.");
    if (row.capacity <= 0) return setError("Capacity must be more than zero.");
    setSaving(true);
    const err = await onSave(row);
    setSaving(false);
    if (err) setError(err);
  }

  return (
    <EditorShell
      title={venue ? `Edit ${venue.name}` : "New venue"}
      dirty={dirty}
      error={error}
      saving={saving}
      saveLabel={venue ? "Save venue" : "Add venue"}
      onClose={onClose}
      onSave={save}
    >
      <div className="grid grid-cols-2 gap-x-3 gap-y-4">
        <div className="col-span-2">
          <Label>Venue name</Label>
          <input className="w-full mt-1" value={f.name} onChange={set("name")} autoFocus />
        </div>
        <div>
          <Label hint="Most guests it can hold">Capacity</Label>
          <input type="number" className="w-full mt-1" value={f.capacity} onChange={set("capacity")} />
        </div>
        <div>
          <Label hint="Charged on smaller functions">Hall charge (Rs.)</Label>
          <input type="number" className="w-full mt-1" value={f.hall_charge} onChange={set("hall_charge")} />
        </div>
        <div>
          <Label hint="Free once guests reach this">Waived at (guests)</Label>
          <input type="number" className="w-full mt-1" value={f.min_waiver} onChange={set("min_waiver")} />
        </div>
        <div>
          <Label hint="Starting price quoted">Decoration from (Rs.)</Label>
          <input type="number" className="w-full mt-1" value={f.decoration_from} onChange={set("decoration_from")} />
        </div>
      </div>
      <div className="mt-4 text-[12px] bg-bg border border-dashed border-border rounded-lg px-3 py-2">
        A function of {Math.max(0, (Number(f.min_waiver) || 0) - 1)} guests pays {money(Number(f.hall_charge) || 0)} hall charge;{" "}
        {Number(f.min_waiver) || 0} or more pay nothing. Up to {Number(f.capacity) || 0} guests fit.
      </div>
    </EditorShell>
  );
}

// ===========================================================================
// Add-on item
// ===========================================================================
function AddonEditorModal({
  item,
  defaultCategory,
  categories,
  onClose,
  onSave,
}: {
  item: AddonItem | null;
  defaultCategory: string;
  categories: string[];
  onClose: () => void;
  onSave: (row: { name: string; category: string; priced: boolean; price: number; unit_label: string | null }) => Promise<string | null>;
}) {
  // Every field is loaded, including the per-piece rate — the old inline
  // editor loaded only the name, so saving a rename wiped the rate.
  const start = {
    name: item?.name || "",
    category: item?.category || defaultCategory,
    newCategory: "",
    priced: Boolean(item?.priced),
    price: String(item?.price ?? ""),
    unit: item?.unit_label || "",
  };
  const [f, setF] = useState(start);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(f) !== JSON.stringify(start);
  const NEW = "__new__";

  async function save() {
    const category = f.category === NEW ? f.newCategory.trim() : f.category;
    if (!f.name.trim()) return setError("Give the item a name.");
    if (!category) return setError("Choose a category, or type a new one.");
    if (f.priced && !(Number(f.price) > 0)) return setError("Enter the rate charged per piece.");
    setSaving(true);
    const err = await onSave({
      name: f.name.trim(),
      category,
      priced: f.priced,
      price: f.priced ? Number(f.price) || 0 : Number(item?.price) || 0,
      unit_label: f.priced ? f.unit.trim() || "piece" : null,
    });
    setSaving(false);
    if (err) setError(err);
  }

  return (
    <EditorShell
      title={item ? `Edit ${item.name}` : "New add-on item"}
      dirty={dirty}
      error={error}
      saving={saving}
      saveLabel={item ? "Save item" : "Add item"}
      onClose={onClose}
      onSave={save}
    >
      <Label>Item name</Label>
      <input className="w-full mt-1 mb-4" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />

      <Label>Category</Label>
      <select className="w-full mt-1" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
        <option value={NEW}>New category…</option>
      </select>
      {f.category === NEW && (
        <input
          className="w-full mt-2"
          value={f.newCategory}
          onChange={(e) => setF({ ...f, newCategory: e.target.value })}
          placeholder="e.g. Breakfast"
        />
      )}

      <div className="mt-4">
        <Label>How it's charged</Label>
        <div className="grid sm:grid-cols-2 gap-2 mt-1.5">
          {[
            { v: false, t: "In the per-head rate", d: "No separate charge — the booking's per-head figure covers it." },
            { v: true, t: "Per piece, on top", d: "Has its own rate, e.g. a whole lamb. The form asks how many." },
          ].map((o) => (
            <button
              key={String(o.v)}
              type="button"
              onClick={() => setF({ ...f, priced: o.v })}
              className={`text-left rounded-lg border px-3 py-2.5 ${
                f.priced === o.v ? "border-gold bg-gold-light/60" : "border-border hover:border-gold/50"
              }`}
              aria-pressed={f.priced === o.v}
            >
              <div className="text-[12.5px] font-bold text-primary">{o.t}</div>
              <div className="text-[11px] text-muted mt-0.5">{o.d}</div>
            </button>
          ))}
        </div>
      </div>

      {f.priced && (
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <Label>Rate (Rs.)</Label>
            <input type="number" className="w-full mt-1" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          </div>
          <div>
            <Label>Per</Label>
            <input className="w-full mt-1" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="lamb, leg piece…" />
          </div>
        </div>
      )}
    </EditorShell>
  );
}

// ===========================================================================
function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 py-1.5">
      <dt className="text-muted">{k}</dt>
      <dd className="font-bold text-right">{v}</dd>
    </div>
  );
}

function Empty({ q, what }: { q: string; what: string }) {
  return (
    <div className="text-center text-sm text-muted py-10">
      {q ? `No ${what} match “${q}”.` : `No ${what} yet.`}
    </div>
  );
}
