-- Consultation audio recording metadata table
-- Run this in Supabase SQL editor before enabling recording uploads in production.

create table if not exists public.consultation_recordings (
  id uuid primary key default gen_random_uuid(),
  queue_entry_id uuid not null references public.queue_entries(id) on delete cascade,
  file_key text not null,
  file_url text not null,
  mime_type text not null,
  size_bytes bigint not null,
  duration_seconds integer,
  transcript_text text,
  created_at timestamptz not null default now()
);

create index if not exists consultation_recordings_queue_entry_id_idx
  on public.consultation_recordings(queue_entry_id);

create index if not exists consultation_recordings_created_at_idx
  on public.consultation_recordings(created_at desc);
