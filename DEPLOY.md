# Deploying this update to Vercel

This zip is the **complete project** — the whole repo with the August 2026
changes already applied. Nothing needs to be merged by hand.

## The two steps

### 1. Run the database migration FIRST

Supabase Dashboard → SQL Editor → New query → paste all of
`supabase/migration-2026-08.sql` → Run.

The app will build fine without this, but pages will throw at runtime because
the new tables and columns won't exist. Do it before you deploy, not after.
The script is idempotent, so running it twice is harmless.

### 2. Replace the repo contents and push

```bash
# from inside your existing clone
git rm -r --cached .          # forget the old file list, keeps files on disk
# now copy everything from this zip over your project folder, overwriting
git add -A
git commit -m "Aug 2026 update: payroll, vendors, refunds, roles, tickets"
git push
```

Vercel redeploys on push. Nothing to change in your Vercel project settings.

---

## Two things that will break the build if you miss them

### Environment variables must exist in Vercel

Vercel Project → Settings → Environment Variables. Both of these must be set for
**Production, Preview and Development**:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

Your `.env.local` is gitignored and never reaches Vercel — if these aren't set in
the dashboard, the build fails when it prerenders pages that construct the
Supabase client. This is the single most common cause of "it works locally but
not on Vercel".

### Don't commit `tsconfig.tsbuildinfo`

Your repo had this file committed. It's TypeScript's incremental build cache, and
a stale one causes type errors on Vercel that don't reproduce locally — the
compiler trusts the cache and reports against files that no longer match. It has
been **deleted from this zip and added to `.gitignore`**. If git still tracks it
in your clone:

```bash
git rm --cached tsconfig.tsbuildinfo
```

---

## Verified before packaging

Run from a clean checkout with no `node_modules` and no build cache:

- `npm ci` — 140 packages, no errors
- `npx tsc --noEmit` — clean
- `npx next build` — compiles, all **17 routes** generated

The only build warning is an existing one from `jspdf`'s bundled fonts, which
predates this change and doesn't affect the output.

---

## If the build still fails

Read the **first** error in the Vercel log, not the last — Next.js prints a
summary at the bottom that's often less useful than the original message.

| Error message contains | Cause |
|---|---|
| `supabaseUrl is required` / `Invalid URL` | Env vars missing in Vercel (see above) |
| `Cannot find module '@/components/SessionContext'` | A file didn't get copied — re-copy `src/` wholesale |
| `relation "vendors" does not exist` | Migration not run yet |
| `column bookings.advance_refunded does not exist` | Migration not run yet |
| `Failed to fetch font 'Inter'` | Transient Google Fonts timeout — just redeploy |

The `@/...` imports resolve via the `paths` mapping in `tsconfig.json`, so the
folder structure has to be exact. `(app)` is a Next.js route group and the
parentheses are part of the real folder name; `[id]` likewise includes the square
brackets. If your OS or file manager stripped them while copying, imports will
resolve but routes will 404.

---

## After it's live — one setting to check

The Owner/CEO monitor-only rule keys off the **role**, not the person's name. Go
to Staff & Access and confirm Mahmud Ali Shah and Afeefa Batool are both set to
**Owner**. Until then they'll still have edit buttons.

While you're there, confirm Zain Syed is **Manager** (Rs. 30,000 discount cap) and
Ikram Abbasi is **General Manager** (Rs. 50,000 cap).
