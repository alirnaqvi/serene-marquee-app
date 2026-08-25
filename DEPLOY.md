# Deploying to Vercel

This zip is the **complete project**. Copy it over your repo, commit, push.

## Step 1 — Run BOTH migrations, in order

Supabase Dashboard → SQL Editor → New query → paste → Run.

1. `supabase/migration-2026-08.sql`  *(skip if you already ran it)*
2. `supabase/migration-2026-09.sql`  ← **new**

Both are idempotent, so re-running either is harmless. Do this **before** you
deploy — the app builds fine without them but pages will throw at runtime.

### About the per-head change in migration 09

Migration 09 sets every menu add-on to **per head**. A few items (cold drinks,
lamb roast, mutton leg, the stalls) had been entered with the wrong quantity
mode and were being multiplied per unit; they are charged per head in practice.

**No prices change.** Every item keeps its current rate — only the quantity mode
is corrected, so quantity now follows the guaranteed guest count like the rest
of the menu already did.

## Step 2 — Push

```bash
git rm --cached tsconfig.tsbuildinfo   # if git still tracks it
# copy this zip's contents over your project folder
git add -A
git commit -m "Sept 2026 update: vendor ledger, xlsx, per-head menu, summaries"
git push
```

`npm install` runs automatically on Vercel and will pick up the one new
dependency (`fflate`, 8KB, used for xlsx generation).

## Environment variables

Must exist in Vercel → Settings → Environment Variables for Production, Preview
and Development:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

---

## Verified before packaging

From a clean checkout, no `node_modules`, no build cache:

- `npm ci` — clean
- `npx tsc --noEmit` — clean
- `npx next build` — all **17 routes** generated
- Generated `.xlsx` files opened and validated with a real spreadsheet parser:
  correct sheet names, numeric cells, number formats, frozen header, autofilter

---

## If the build fails

| Error contains | Cause |
|---|---|
| `supabaseUrl is required` | Env vars missing in Vercel |
| `Cannot find module 'fflate'` | `npm install` didn't run — redeploy without build cache |
| `Cannot find module '@/lib/xlsx'` | `src/lib/xlsx.ts` didn't get copied |
| `Cannot find module '@/lib/exportLedger'` | A stale file still imports the deleted CSV module — delete it |
| `relation "vendor_transactions" does not exist` | Migration 09 not run |
| `column bookings.advance_refunded does not exist` | Migration 08 not run |

Note `src/lib/exportLedger.ts` has been **deleted** — CSV export is gone
everywhere, replaced by real xlsx. If your copy still has that file, remove it.
