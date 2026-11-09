-- Um único documento financeiro por usuário, protegido pela conta Google autorizada.
create table if not exists public.personal_finance_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.personal_finance_data enable row level security;

drop policy if exists "Only Ruans Google account can access GestorPro data" on public.personal_finance_data;
create policy "Only Ruans Google account can access GestorPro data"
  on public.personal_finance_data
  for all to authenticated
  using (
    user_id = (select auth.uid())
    and lower((select auth.jwt())->>'email') = 'ruandiasmaiasilva@gmail.com'
    and ((select auth.jwt())->'app_metadata'->>'provider') = 'google'
  )
  with check (
    user_id = (select auth.uid())
    and lower((select auth.jwt())->>'email') = 'ruandiasmaiasilva@gmail.com'
    and ((select auth.jwt())->'app_metadata'->>'provider') = 'google'
  );

grant select, insert, update, delete on public.personal_finance_data to authenticated;
