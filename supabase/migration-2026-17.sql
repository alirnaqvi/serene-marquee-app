-- ============================================================================
-- SERENE MARQUEE — MIGRATION 2026-17
-- Run AFTER migration 2026-16. Safe to re-run.
--
--   Storage for the PDFs that go out to clients on WhatsApp.
--
--   On a phone this is never touched: the PDF is handed straight to the share
--   sheet as a file and attached to the chat. It only comes into play on a
--   desktop browser that can't share files, where the document is uploaded
--   here and a signed link is sent instead.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- The bucket is PRIVATE. A client's invoice carries their name, CNIC, phone
-- number and what they are paying, so nothing in here is readable by URL
-- alone. The link sent on WhatsApp is a signed one that expires; anyone
-- without it — and anyone after it expires — gets nothing.

drop policy if exists "documents_staff_upload" on storage.objects;
create policy "documents_staff_upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and public.can_write_data());

drop policy if exists "documents_staff_read" on storage.objects;
create policy "documents_staff_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents');

-- An invoice that was re-sent after a correction leaves the older copy behind.
-- Staff who can write bookings can clear those out.
drop policy if exists "documents_staff_delete" on storage.objects;
create policy "documents_staff_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents' and public.can_write_data());

-- ---------------------------------------------------------------------------
-- HOUSEKEEPING
--
-- Nothing deletes these automatically. If the folder grows uncomfortably, this
-- clears anything older than six months — by which point every signed link to
-- it has long expired, so nothing in use is broken:
--
--   delete from storage.objects
--   where bucket_id = 'documents'
--     and created_at < now() - interval '6 months';
-- ============================================================================
