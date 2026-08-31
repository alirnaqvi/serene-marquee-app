"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { calcTotals, money, parseMenuItems } from "@/lib/calculations";
import { CONFIRMATION_MINIMUM, ENTRY_TEST_RATE } from "@/lib/constants";
import { FUNCTION_TYPES, CLIENT_TITLES, clientName, canConfirmBooking, statusForAdvance } from "@/types";
import type { Venue, Menu, Booking, AddonItem, ClientTitle } from "@/types";
import CustomMenuModal, { type CustomSelection, resyncGuestQuantities } from "@/components/CustomMenuModal";
import DateField from "@/components/DateField";
import AlertModal from "@/components/AlertModal";
import DiscountField from "@/components/DiscountField";
import { useSession } from "@/components/SessionContext";

const CUSTOM_MENU_VALUE = "__custom__";
type NumField = number | "";
const n = (v: NumField) => Number(v) || 0;

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export default function EditBookingPage() {
  const router = useRouter();
  const params = useParams();
  const bookingId = params.id as string;
  const supabase = createClient();
  const { role, discountLimit, readOnly } = useSession();

  const [loaded, setLoaded] = useState(false);
  const [original, setOriginal] = useState<Booking | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [addonItems, setAddonItems] = useState<AddonItem[]>([]);
  const [existingBookings, setExistingBookings] = useState<Booking[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictAlert, setConflictAlert] = useState<string | null>(null);
  const [originalDate, setOriginalDate] = useState("");

  const [selectedVenues, setSelectedVenues] = useState<string[]>([]);
  const [session, setSession] = useState<"Lunch" | "Dinner">("Lunch");
  const [date, setDate] = useState("");
  const [functionType, setFunctionType] = useState<string>(FUNCTION_TYPES[0]);
  const [functionTypeOther, setFunctionTypeOther] = useState("");
  const [entryTestType, setEntryTestType] = useState("");
  const [title, setTitle] = useState<ClientTitle | "">("");
  const [client, setClient] = useState("");
  const [phone, setPhone] = useState("");
  const [phone2, setPhone2] = useState("");
  const [cnic, setCnic] = useState("");
  const [email, setEmail] = useState("");
  const [guests, setGuests] = useState<NumField>("");
  const [menuId, setMenuId] = useState("");
  const [showCustomMenuModal, setShowCustomMenuModal] = useState(false);
  const [customSelection, setCustomSelection] = useState<CustomSelection[]>([]);
  const [showAddOnsModal, setShowAddOnsModal] = useState(false);
  const [addOnSelection, setAddOnSelection] = useState<CustomSelection[]>([]);
  const [removedMenuItems, setRemovedMenuItems] = useState<string[]>([]);
  const [discount, setDiscount] = useState<NumField>("");
  const [reference, setReference] = useState("");
  const [filer, setFiler] = useState<"Filer" | "Non-Filer">("Filer");
  const [decoration, setDecoration] = useState<NumField>("");
  const [heaters, setHeaters] = useState<NumField>("");
  const [cooling, setCooling] = useState(false);
  const [advance, setAdvance] = useState<NumField>("");
  const [status, setStatus] = useState<"Tentative" | "Confirmed" | "Cancelled">("Confirmed");
  // Remembers what the advance was when the booking was loaded, so entering
  // one for the first time can promote a Tentative booking to Confirmed.
  const [loadedAdvance, setLoadedAdvance] = useState(0);
  const [notes, setNotes] = useState("");

  const isEntryTest = functionType === "Entry Test";
  const isCustomMenu = !isEntryTest && menuId === CUSTOM_MENU_VALUE;
  const customMenuTotal = customSelection.reduce((s, c) => s + c.unit_price * c.quantity, 0);
  const addOnsTotal = addOnSelection.reduce((s, c) => s + c.unit_price * c.quantity, 0);
  const selectedMenu = menus.find((m) => m.id === menuId);

  useEffect(() => {
    async function load() {
      const [{ data: v }, { data: m }, { data: a }, { data: b }, { data: booking }, { data: bAddons }] = await Promise.all([
        supabase.from("venues").select("*"),
        supabase.from("menus").select("*"),
        supabase.from("addon_items").select("*"),
        supabase.from("bookings").select("*").neq("status", "Cancelled").neq("id", bookingId),
        supabase.from("bookings").select("*").eq("id", bookingId).single(),
        supabase.from("booking_addons").select("*").eq("booking_id", bookingId),
      ]);
      setVenues(v || []);
      setMenus(m || []);
      setAddonItems(a || []);
      setExistingBookings(b || []);

      if (booking) {
        setOriginal(booking);
        setSelectedVenues(booking.venues);
        setSession(booking.session);
        setDate(booking.event_date);
        setOriginalDate(booking.event_date);
        setFunctionType(booking.function_type);
        setFunctionTypeOther(booking.function_type_other || "");
        setEntryTestType(booking.entry_test_type || "");
        setTitle(booking.title || "");
        setClient(booking.client);
        setPhone(booking.phone || "");
        setPhone2(booking.phone2 || "");
        setCnic(booking.cnic || "");
        setEmail(booking.email || "");
        setGuests(booking.guests || "");
        setMenuId(booking.is_custom_menu ? CUSTOM_MENU_VALUE : booking.menu_id || (m && m[0]?.id) || "");
        setRemovedMenuItems(booking.removed_menu_items || []);
        setDiscount(booking.discount || "");
        setReference(booking.reference || "");
        setFiler(booking.filer);
        setDecoration(booking.decoration || "");
        setHeaters(booking.heaters || "");
        setCooling(booking.cooling);
        setAdvance(booking.advance || "");
        setLoadedAdvance(booking.advance);
        setStatus(booking.status);
        setNotes(booking.notes || "");

        const selection: CustomSelection[] = (bAddons || []).map((ba) => ({
          addon_item_id: ba.addon_item_id || "",
          name: ba.name,
          unit_price: ba.unit_price,
          quantity: ba.quantity,
        }));
        if (booking.is_custom_menu) setCustomSelection(selection);
        else setAddOnSelection(selection);
      }
      setLoaded(true);
    }
    load();
  }, [bookingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // If the guest count changes after items were already picked, keep every
  // per-head item's quantity tracking the new count instead of going stale.
  useEffect(() => {
    if (addonItems.length === 0) return;
    setCustomSelection((prev) => resyncGuestQuantities(prev, addonItems, n(guests)));
    setAddOnSelection((prev) => resyncGuestQuantities(prev, addonItems, n(guests)));
  }, [guests, addonItems]);

  function toggleVenue(id: string) {
    setSelectedVenues((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }

  function handleMenuChange(value: string) {
    setMenuId(value);
    setRemovedMenuItems([]); // a different offered menu has a different item list
    if (value === CUSTOM_MENU_VALUE) {
      setAddOnSelection([]);
      setShowCustomMenuModal(true);
    }
  }

  function handleFunctionTypeChange(value: string) {
    setFunctionType(value);
    if (value === "Entry Test") {
      // Entry Test bookings don't use any menu — clear out any prior selection.
      setMenuId("");
      setCustomSelection([]);
      setAddOnSelection([]);
      setRemovedMenuItems([]);
    } else if (functionType === "Entry Test") {
      setEntryTestType("");
      if (menus.length) setMenuId(menus[0].id);
    }
  }

  function toggleMenuItem(item: string) {
    setRemovedMenuItems((prev) => (prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]));
  }

  // Excludes this booking's own prior slot, so keeping the same date/venue/session isn't flagged as a clash.
  const conflicts = selectedVenues
    .map((vid) => {
      const clash = existingBookings.find(
        (b) => b.venues.includes(vid) && b.session === session && b.event_date === date
      );
      return clash ? { venueId: vid, clash } : null;
    })
    .filter((c): c is { venueId: string; clash: Booking } => Boolean(c));

  function conflictMessage() {
    return `Already booked for ${session} on ${date || "this date"}: ${conflicts
      .map((c) => `${venues.find((v) => v.id === c.venueId)?.name} (${clientName(c.clash)})`)
      .join(", ")}. Choose a different date, session, or venue.`;
  }

  // Surface the popup the moment a clashing date/session/venue is selected,
  // instead of waiting until Save Changes is clicked.
  useEffect(() => {
    setConflictAlert(conflicts.length > 0 ? conflictMessage() : null);
  }, [date, session, selectedVenues.join(","), existingBookings.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = calcTotals(
    {
      guests: n(guests),
      venues: selectedVenues,
      menuId: isCustomMenu ? null : menuId,
      isCustomMenu,
      isEntryTest,
      customMenuTotal,
      addonsTotal: isCustomMenu || isEntryTest ? 0 : addOnsTotal,
      discount: n(discount),
      filer,
      decoration: n(decoration),
      heaters: n(heaters),
      cooling,
      advance: n(advance),
    },
    venues,
    menus
  );

  // Confirmed requires at least Rs. 25,000 in hand. Bringing the advance up to
  // that threshold promotes a Tentative booking to Confirmed; dropping back
  // below it returns the booking to Tentative. Cancelled is deliberate and is
  // never overridden here.
  useEffect(() => {
    if (status === "Cancelled") return;
    if (canConfirmBooking(n(advance)) && !canConfirmBooking(loadedAdvance) && status === "Tentative") {
      setStatus("Confirmed");
    }
  }, [advance, loadedAdvance]); // eslint-disable-line react-hooks/exhaustive-deps

  const advancePaid = canConfirmBooking(n(advance));
  const effectiveStatus = statusForAdvance(n(advance), status);

  async function handleSave() {
    setError(null);
    if (!client.trim()) return setError("Please enter a client name.");
    if (!phone.trim()) return setError("Please enter a phone number.");
    if (!cnic.trim()) return setError("Please enter the host's CNIC.");
    if (!date) return setError("Please choose a function date.");
    // Only block if the date was actually changed to something in the past —
    // this still allows correcting other details on an already-past event.
    if (date !== originalDate && date < todayIso()) {
      return setError("You can't reschedule to a date that has already passed. Please choose today or a future date.");
    }
    if (selectedVenues.length === 0) return setError("Please select at least one venue.");
    // Discount authority is capped per role, and an approved request acts as a
    // one-time permit above that cap. Whether a permit exists is only knowable
    // in the database, so enforce_discount_limit() is the authority here — its
    // error message is already written for the user and surfaces below.
    if (isCustomMenu && customSelection.length === 0) {
      return setError("Please pick at least one item for the Customized Menu, or choose a regular menu instead.");
    }
    if (isEntryTest && !entryTestType.trim()) {
      return setError("Please enter the type of entry test (e.g. MDCAT, ECAT).");
    }
    if (conflicts.length > 0) {
      setConflictAlert(conflictMessage());
      return;
    }

    setSaving(true);

    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        venues: selectedVenues,
        session,
        event_date: date,
        title: title || null,
        client: client.trim(),
        phone,
        phone2,
        cnic,
        email,
        function_type: functionType,
        function_type_other: functionType === "Other" ? functionTypeOther : null,
        entry_test_type: isEntryTest ? entryTestType.trim() : null,
        guests: n(guests),
        menu_id: isEntryTest || isCustomMenu ? null : menuId,
        is_custom_menu: isCustomMenu,
        custom_menu_total: isCustomMenu ? customMenuTotal : 0,
        addons_total: isCustomMenu || isEntryTest ? 0 : addOnsTotal,
        removed_menu_items: isEntryTest || isCustomMenu ? [] : removedMenuItems,
        discount: n(discount),
        reference,
        filer,
        decoration: n(decoration),
        heaters: n(heaters),
        cooling,
        advance: n(advance),
        notes,
        status: effectiveStatus,
      })
      .eq("id", bookingId);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    // Simplest way to keep booking_addons in sync with the edited selection:
    // clear out the old rows for this booking and re-insert the current one.
    await supabase.from("booking_addons").delete().eq("booking_id", bookingId);
    const activeSelection = isCustomMenu ? customSelection : addOnSelection;
    if (activeSelection.length > 0) {
      await supabase.from("booking_addons").insert(
        activeSelection.map((c) => ({
          booking_id: bookingId,
          addon_item_id: c.addon_item_id,
          name: c.name,
          unit_price: c.unit_price,
          quantity: c.quantity,
          line_total: c.unit_price * c.quantity,
        }))
      );
    }

    router.push(`/bookings/${bookingId}`);
  }

  if (!loaded) return <div className="text-muted text-sm">Loading…</div>;

  // Owner / CEO accounts are monitor-only — block the form outright rather
  // than letting them fill it in and hit a database rejection on save.
  if (readOnly) {
    return (
      <div className="card max-w-md">
        <div className="text-[14.5px] font-bold text-primary mb-2">View-only access</div>
        <div className="text-sm text-muted">
          Your account can monitor every booking but cannot edit bookings. Ask a manager to make
          the change for you.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="text-xl font-bold font-serif text-primary mb-4">Edit Booking</div>
      <div className="text-[11.5px] text-muted bg-bg border border-dashed border-border rounded-lg px-3 py-2 mb-4">
        Editing Ref #{bookingId.slice(0, 8).toUpperCase()} — changes save immediately and sync to everyone viewing this booking.
      </div>

      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div className="sm:col-span-2">
            <label className="text-xs font-bold text-muted uppercase">
              Venue(s) <span className="normal-case font-normal text-muted">— select more than one for a two-hall event</span>
            </label>
            <div className="flex flex-col gap-2 border border-border rounded-lg p-3 bg-bg mt-1">
              {venues.map((v) => (
                <label key={v.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={selectedVenues.includes(v.id)} onChange={() => toggleVenue(v.id)} />
                  {v.name} (max {v.capacity}, hall charge waived at {v.min_waiver}+ guests)
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-muted uppercase">Session</label>
            <select className="w-full mt-1" value={session} onChange={(e) => setSession(e.target.value as any)}>
              <option>Lunch</option>
              <option>Dinner</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-muted uppercase">Function Date</label>
            <DateField value={date} onChange={setDate} className="mt-1" />
          </div>

          <div>
            <label className="text-xs font-bold text-muted uppercase">Function Type</label>
            <select className="w-full mt-1" value={functionType} onChange={(e) => handleFunctionTypeChange(e.target.value)}>
              {FUNCTION_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          {functionType === "Other" && (
            <div>
              <label className="text-xs font-bold text-muted uppercase">Please specify</label>
              <input className="w-full mt-1" value={functionTypeOther} onChange={(e) => setFunctionTypeOther(e.target.value)} placeholder="e.g. Aqeeqah, Anniversary..." />
            </div>
          )}
          {isEntryTest && (
            <div>
              <label className="text-xs font-bold text-muted uppercase">Type of Entry Test</label>
              <input
                className="w-full mt-1"
                value={entryTestType}
                onChange={(e) => setEntryTestType(e.target.value)}
                placeholder="e.g. MDCAT, ECAT, NUST NET"
              />
            </div>
          )}

          <div className="sm:col-span-2 text-xs font-bold text-gold-deep uppercase tracking-wide mt-3 pt-3 border-t border-border">
            Host Details
          </div>
          <div>
            <label className="text-xs font-bold text-muted uppercase">Client / Host Name <span className="text-rose">*</span></label>
            <div className="flex gap-2 mt-1">
              <select
                className="w-[88px] shrink-0"
                value={title}
                onChange={(e) => setTitle(e.target.value as ClientTitle | "")}
                aria-label="Title"
              >
                <option value="">—</option>
                {CLIENT_TITLES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <input
                className="flex-1 min-w-0"
                value={client}
                onChange={(e) => setClient(e.target.value)}
                placeholder="e.g. Ahmed Khan"
                required
              />
            </div>
            <div className="text-[11px] text-muted mt-1">
              Leave the title blank for a family or an organization.
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-muted uppercase">Phone Number <span className="text-rose">*</span></label>
            <input className="w-full mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="03XX-XXXXXXX" required />
          </div>
          <div>
            <label className="text-xs font-bold text-muted uppercase">Second Phone Number <span className="normal-case font-normal">(optional)</span></label>
            <input className="w-full mt-1" value={phone2} onChange={(e) => setPhone2(e.target.value)} placeholder="03XX-XXXXXXX" />
          </div>
          <div>
            <label className="text-xs font-bold text-muted uppercase">CNIC <span className="text-rose">*</span></label>
            <input className="w-full mt-1" value={cnic} onChange={(e) => setCnic(e.target.value)} placeholder="XXXXX-XXXXXXX-X" required />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-bold text-muted uppercase">Email (optional)</label>
            <input className="w-full mt-1" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>

          <div className="sm:col-span-2 text-xs font-bold text-gold-deep uppercase tracking-wide mt-3 pt-3 border-t border-border">
            {isEntryTest ? "Entry Test & Guests" : "Menu & Guests"}
          </div>
          <div>
            <label className="text-xs font-bold text-muted uppercase">
              {isEntryTest ? "Number of Guests (Students)" : "Guest Count"}
            </label>
            <input
              type="number"
              className="w-full mt-1"
              value={guests}
              onChange={(e) => setGuests(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </div>
          {isEntryTest ? (
            <div>
              <label className="text-xs font-bold text-muted uppercase">
                Rate <span className="normal-case font-normal">(fixed for all entry tests)</span>
              </label>
              <div className="w-full mt-1 text-sm font-semibold text-gold-deep px-3 py-2 border border-border rounded-lg bg-bg">
                {money(ENTRY_TEST_RATE)} / head
              </div>
            </div>
          ) : (
            <div>
              <label className="text-xs font-bold text-muted uppercase">Menu</label>
              <select className="w-full mt-1" value={menuId} onChange={(e) => handleMenuChange(e.target.value)}>
                {menus.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} — {money(m.rate)}/head
                  </option>
                ))}
                <option value={CUSTOM_MENU_VALUE}>Customized Menu… (build entirely from add-ons)</option>
              </select>
              {!isCustomMenu && selectedMenu && (
                <div className="mt-1.5 text-[11.5px] text-muted leading-snug">
                  <div className="mb-1">Includes (tap × to remove an item for this booking):</div>
                  <div className="flex flex-wrap gap-1.5">
                    {parseMenuItems(selectedMenu.items).map((item) => {
                      const removed = removedMenuItems.includes(item);
                      return (
                        <span
                          key={item}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                            removed
                              ? "border-border text-muted line-through opacity-60"
                              : "border-gold bg-gold-light text-gold-deep"
                          }`}
                        >
                          {item}
                          <button
                            type="button"
                            onClick={() => toggleMenuItem(item)}
                            className="font-bold leading-none"
                            title={removed ? "Add back to menu" : "Remove from menu"}
                          >
                            {removed ? "+" : "×"}
                          </button>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
              {isCustomMenu && (
                <div className="mt-1.5 flex items-center justify-between text-[12px] bg-gold-light border border-gold rounded-md px-2.5 py-1.5">
                  <span className="text-gold-deep font-semibold">
                    {customSelection.length} item{customSelection.length === 1 ? "" : "s"} selected — {money(customMenuTotal)}
                  </span>
                  <button type="button" onClick={() => setShowCustomMenuModal(true)} className="text-gold-deep font-bold underline">
                    Edit
                  </button>
                </div>
              )}
              {!isCustomMenu && (
                <div className="mt-1.5">
                  <button type="button" onClick={() => setShowAddOnsModal(true)} className="text-[12px] font-bold text-gold-deep underline">
                    {addOnSelection.length > 0
                      ? `${addOnSelection.length} extra item${addOnSelection.length === 1 ? "" : "s"} added — ${money(addOnsTotal)}/head extra — Edit`
                      : "+ Customize this menu (add extra items)"}
                  </button>
                </div>
              )}
            </div>
          )}
          <DiscountField
            value={discount}
            onChange={setDiscount}
            context={{
              bookingId,
              bookingNumber: original?.booking_number ?? null,
              clientName: client,
              eventDate: date,
              guests: n(guests),
              menuLabel: isEntryTest
                ? "Entry Test (flat per head)"
                : isCustomMenu
                ? "Customized Menu"
                : selectedMenu?.name,
              venueLabel: selectedVenues
                .map((id) => venues.find((v) => v.id === id)?.name)
                .filter(Boolean)
                .join(" + "),
              session,
              functionLabel: functionType === "Other" ? functionTypeOther : functionType,
              bookingTotal: totals.grandTotal,
              currentDiscount: original?.discount ?? 0,
            }}
          />
          <div>
            <label className="text-xs font-bold text-muted uppercase">Filer Status</label>
            <select className="w-full mt-1" value={filer} onChange={(e) => setFiler(e.target.value as any)}>
              <option>Filer</option>
              <option>Non-Filer</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-bold text-muted uppercase">Discount Reference / Given By</label>
            <input className="w-full mt-1" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. Referred by M. Javed" />
          </div>

          <div className="sm:col-span-2 text-xs font-bold text-gold-deep uppercase tracking-wide mt-3 pt-3 border-t border-border">
            Charges (finalized in office)
          </div>
          <div>
            <label className="text-xs font-bold text-muted uppercase">Decoration Charge</label>
            <input
              type="number"
              className="w-full mt-1"
              value={decoration}
              onChange={(e) => setDecoration(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </div>
          <div>
            <label className="text-xs font-bold text-muted uppercase">Heaters Required</label>
            <input
              type="number"
              className="w-full mt-1"
              value={heaters}
              onChange={(e) => setHeaters(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </div>
          <div className="sm:col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={cooling} onChange={(e) => setCooling(e.target.checked)} />
            Cooling required (+Rs. 100,000 per hall selected)
          </div>

          <div className="sm:col-span-2 text-xs font-bold text-gold-deep uppercase tracking-wide mt-3 pt-3 border-t border-border">
            Payment & Status
          </div>
          <div>
            <label className="text-xs font-bold text-muted uppercase">
              Advance Paid <span className="normal-case font-normal">(Rs. {CONFIRMATION_MINIMUM.toLocaleString()} min. to confirm)</span>
            </label>
            <input
              type="number"
              className="w-full mt-1"
              value={advance}
              onChange={(e) => setAdvance(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </div>
          <div>
            <label className="text-xs font-bold text-muted uppercase">Status</label>
            <select
              className="w-full mt-1"
              value={effectiveStatus}
              onChange={(e) => setStatus(e.target.value as any)}
            >
              <option disabled={!advancePaid && status !== "Tentative"}>Tentative</option>
              <option disabled={!advancePaid}>Confirmed</option>
              <option>Cancelled</option>
            </select>
            <div className="text-[11px] text-muted mt-1">
              {advancePaid
                ? "Advance received — this booking can be confirmed."
                : `Tentative until an advance of at least Rs. ${CONFIRMATION_MINIMUM.toLocaleString()} is received.`}
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-bold text-muted uppercase">
              Special Instructions / Decoration Details{" "}
              <span className="normal-case font-normal">(no length limit — write as much as you need)</span>
            </label>
            <textarea className="w-full mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} rows={6} />
          </div>
        </div>

        <div className="bg-primary-dim rounded-lg p-4 mt-4 grid grid-cols-2 gap-2 text-[12.5px]">
          <div className="text-gold-deep opacity-85">
            {isEntryTest
              ? `Entry Test Fee (${n(guests)} × ${money(ENTRY_TEST_RATE)})`
              : `Food Subtotal${isCustomMenu ? " (Customized Menu)" : addOnsTotal > 0 ? " (incl. extra items)" : ""}`}
          </div>
          <div className="text-right font-bold text-gold-deep">{money(totals.foodSubtotal)}</div>
          <div className="text-gold-deep opacity-85">KPRA Tax (15%)</div>
          <div className="text-right font-bold text-gold-deep">+ {money(totals.kprTax)}</div>
          <div className="text-gold-deep opacity-85">Hall Charge{selectedVenues.length > 1 ? " (both halls)" : ""}</div>
          <div className="text-right font-bold text-gold-deep">+ {money(totals.hallCharge)}</div>
          <div className="text-gold-deep opacity-85">Decoration</div>
          <div className="text-right font-bold text-gold-deep">+ {money(totals.decoration)}</div>
          <div className="text-gold-deep opacity-85">Cooling / Heating</div>
          <div className="text-right font-bold text-gold-deep">+ {money(totals.coolingCharge + totals.heatingCharge)}</div>
          <div className="text-gold-deep opacity-85">Income Tax ({filer}, {totals.incomeTaxRate * 100}%)</div>
          <div className="text-right font-bold text-gold-deep">+ {money(totals.incomeTax)}</div>
          <div className="col-span-2 border-t border-[#8A6A1E]/25 pt-1.5 mt-0.5 flex justify-between text-[13px] font-bold text-gold-deep">
            <span>Total (before discount)</span>
            <span>{money(totals.totalBeforeDiscount)}</span>
          </div>
          <div className="text-gold-deep opacity-85">Discount</div>
          <div className="text-right font-bold text-gold-deep">- {money(totals.discountAmount)}</div>
          <div className="text-gold-deep opacity-85">Advance Paid</div>
          <div className="text-right font-bold text-gold-deep">- {money(n(advance))}</div>
          <div className="col-span-2 border-t border-[#8A6A1E]/25 pt-2 mt-1 flex justify-between text-base font-bold text-primary">
            <span>Balance Due</span>
            <span>{money(totals.grandTotal - n(advance))}</span>
          </div>
        </div>

        {error && <div className="text-rose text-sm font-semibold mt-3">{error}</div>}

        <div className="flex justify-end gap-2.5 mt-5">
          <button onClick={() => router.back()} className="btn-ghost rounded-lg px-4 py-2 text-sm">
            Discard Changes
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-primary rounded-lg px-4 py-2 text-sm">
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>

      {showCustomMenuModal && (
        <CustomMenuModal
          items={addonItems}
          guests={n(guests)}
          initialSelection={customSelection}
          title="Customized Menu"
          subtitle="Build this booking's entire menu from individual items — this replaces the fixed per-head rate."
          confirmLabel="Use as Menu"
          onClose={() => {
            setShowCustomMenuModal(false);
            if (customSelection.length === 0 && menus.length) setMenuId(menus[0].id);
          }}
          onConfirm={(selection) => {
            setCustomSelection(selection);
            setShowCustomMenuModal(false);
          }}
        />
      )}

      {showAddOnsModal && (
        <CustomMenuModal
          items={addonItems}
          guests={n(guests)}
          initialSelection={addOnSelection}
          title="Customize This Menu"
          subtitle="Selected items are added to the per-head rate of the menu already chosen above (Lamb Roast and Stalls are added as flat charges instead, since they're priced per unit, not per head)."
          confirmLabel="Add Extra Items"
          onClose={() => setShowAddOnsModal(false)}
          onConfirm={(selection) => {
            setAddOnSelection(selection);
            setShowAddOnsModal(false);
          }}
        />
      )}

      {conflictAlert && (
        <AlertModal title="Date already booked" message={conflictAlert} tone="danger" onClose={() => setConflictAlert(null)} />
      )}
    </div>
  );
}
