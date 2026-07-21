# Serene Marquee — Operations

A real, multi-user booking/calendar/ledger system for Serene Marquee. Built with
Next.js 14 and Supabase (Postgres + Auth + Realtime).

This replaces the single-file prototype with an actual deployable app:
- Data is stored in a real database and persists (nothing resets on refresh).
- Multiple staff can be logged in on different phones/computers at once, and
  see each other's bookings live (via Supabase Realtime).
- The daily ledger is restricted at the database level (not just hidden in
  the UI) to staff whose profile has ledger access.

---

## 1. What you'll need (free to start)

- A [Supabase](https://supabase.com) account — free tier is enough for this.
- A [Vercel](https://vercel.com) account — free tier is enough for this.
- A [GitHub](https://github.com) account, to hold the code so Vercel can deploy it.
- Node.js 18+ installed on your own computer, if you want to run it locally first.

No domain is required to start — Vercel gives you a free `yourapp.vercel.app`
address. You can point a real domain (e.g. `serenemarquee.com`) at it later
from Vercel's dashboard whenever you buy one.

---

## 2. Set up the database (Supabase)

1. Go to [supabase.com](https://supabase.com) → **New Project**.
   - Pick any project name (e.g. `serene-marquee`) and a strong database password (save it somewhere).
   - Pick a region close to Pakistan (e.g. Singapore) for the best speed.
2. Once the project finishes setting up, go to the **SQL Editor** (left sidebar).
3. Open `supabase/schema.sql` from this project, copy its entire contents,
   paste into a new query in the SQL Editor, and click **Run**.
   - This creates all tables (venues, menus, bookings, ledger, staff profiles),
     pre-fills the venues/menus with your current rates, and sets up the
     security rules that restrict the ledger.
4. Go to **Project Settings → API**. You'll need two values from this page
   in the next step:
   - **Project URL**
   - **anon public** key

---

## 3. Configure the app

1. Copy `.env.local.example` to a new file named `.env.local`.
2. Paste in the Project URL and anon key from step 2.4:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
   ```

---

## 4. Run it locally (optional, to try before deploying)

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Click **New Staff** on the login screen to
create your own account first (this becomes a normal staff account — see
step 6 to make yourself an owner with ledger access).

---

## 5. Deploy it for real (Vercel)

1. Push this project to a new GitHub repository (if you're not comfortable
   with git, GitHub Desktop or Claude Code can do this for you — just say
   the word and I'll walk you through it).
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import that
   GitHub repository.
3. When it asks for environment variables, add the same two values from your
   `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Click **Deploy**. In a couple of minutes you'll get a live URL like
   `serene-marquee.vercel.app` — this is what you send to your father and staff.

---

## 6. Add staff and control ledger access

Anyone can create their own account from the app's login screen ("New Staff")
— they'll start as a regular staff member **without** ledger access by default.

To grant someone access to the ledger, or make them an owner/manager:

1. In Supabase, go to **Table Editor → profiles**.
2. Find their row (matched by name/email).
3. Set `can_view_ledger` to `true`, or set `role` to `owner` or `manager`
   (owners/managers automatically see the ledger).

This is enforced by the database itself — even if someone tried to bypass
the app's interface, they still couldn't read the ledger table without one
of these being set. This is exactly the "only some people can see the daily
ledger" requirement, done properly rather than just hidden in the UI.

There's no in-app admin screen for this yet — it's a couple of clicks in the
Supabase dashboard each time. That's a reasonable first version; a proper
admin screen (so your father doesn't have to touch Supabase) is a natural
next addition.

---

## 7. What's included vs. what's next

**Included and working:**
- Real multi-user data with live sync (Supabase Realtime)
- Login / staff accounts
- Dashboard, Calendar (multi-venue, conflict-checked), Bookings (single or
  two-hall), Ledger (access-restricted), Menus & Venues reference
- Full charge calculation: KPR tax, income tax by filer status, hall charge
  waivers, cooling/heating, decoration, discounts
- PDF agreement generation and download, with the Serene Marquee logo
- Live clock + booking timestamps

**Reasonable next steps, not yet built:**
- True offline support (the app needs internet right now; a full offline-first
  version with local caching and background sync is a bigger follow-up project)
- An in-app screen for managing staff roles/ledger access (currently done via
  Supabase's dashboard, see step 6)
- Editing/cancelling existing bookings (currently create + view; edit can be
  added the same way the New Booking form works)
- Menu/venue rate editing from within the app (currently edited via Supabase's
  Table Editor, or by re-running SQL)

---

## Project structure

```
src/
  app/
    login/                  Staff sign-in / sign-up
    (app)/                  Everything behind login, shares the sidebar layout
      dashboard/
      calendar/
      bookings/
        new/                 New booking form
        [id]/                Booking detail + PDF download
      ledger/                Access-restricted by Supabase RLS
      menus/                 Menu & venue reference
  components/                Sidebar, LiveClock
  lib/
    supabase/                Browser + server Supabase clients
    calculations.ts          All charge/tax math, shared everywhere
    constants.ts              Tax rates and charge rules — edit here if rates change
    generateAgreementPdf.ts   PDF generation
  types/                      Shared TypeScript types
supabase/
  schema.sql                  Full database schema + security rules
```
