-- Guarda somente resumos agregados da revisão diária, sem descrições de compras.
create table if not exists public.daily_financial_reviews (
  user_id uuid not null references auth.users(id) on delete cascade,
  review_date date not null,
  period_start date not null,
  period_end date not null,
  expense_total numeric(14,2) not null default 0,
  transaction_count integer not null default 0,
  category_totals jsonb not null default '{}'::jsonb,
  alerts jsonb not null default '[]'::jsonb,
  coaching jsonb not null default '[]'::jsonb,
  previous_period_total numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, review_date)
);

alter table public.daily_financial_reviews enable row level security;

drop policy if exists "Only Ruans Google account can read daily reviews" on public.daily_financial_reviews;
create policy "Only Ruans Google account can read daily reviews"
  on public.daily_financial_reviews
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and lower((select auth.jwt())->>'email') = 'ruandiasmaiasilva@gmail.com'
    and ((select auth.jwt())->'app_metadata'->>'provider') = 'google'
  );

grant select on public.daily_financial_reviews to authenticated;
