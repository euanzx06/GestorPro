-- GestorPro pessoal: dados sempre pertencem ao usuário autenticado.
create extension if not exists pgcrypto;

create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  institution text,
  account_type text not null check (account_type in ('checking','savings','investment','wallet')),
  current_balance numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  to_account_id uuid,
  description text not null check (char_length(description) between 1 and 180),
  category text not null,
  direction text not null check (direction in ('income','expense','transfer')),
  amount numeric(14,2) not null check (amount > 0),
  transaction_date date not null default current_date,
  created_at timestamptz not null default now(),
  constraint transactions_owned_account_fk
    foreign key (account_id, user_id)
    references public.bank_accounts(id, user_id) on delete cascade,
  constraint transactions_owned_destination_fk
    foreign key (to_account_id, user_id)
    references public.bank_accounts(id, user_id) on delete cascade,
  constraint transactions_transfer_accounts_check check (
    (direction = 'transfer' and to_account_id is not null and to_account_id <> account_id)
    or (direction <> 'transfer' and to_account_id is null)
  )
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  month date not null,
  limit_amount numeric(14,2) not null check (limit_amount > 0),
  created_at timestamptz not null default now(),
  unique (user_id, category, month)
);

create index bank_accounts_user_idx on public.bank_accounts(user_id, created_at desc);
create index transactions_user_date_idx on public.transactions(user_id, transaction_date desc);
create index transactions_account_date_idx on public.transactions(account_id, transaction_date desc);
create index budgets_user_month_idx on public.budgets(user_id, month desc);

alter table public.bank_accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;

create policy "Users manage only their own accounts" on public.bank_accounts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users manage only their own transactions" on public.transactions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id and
    exists (select 1 from public.bank_accounts a where a.id = account_id and a.user_id = (select auth.uid())) and
    (to_account_id is null or exists (select 1 from public.bank_accounts a where a.id = to_account_id and a.user_id = (select auth.uid())))
  );

create policy "Users manage only their own budgets" on public.budgets
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.bank_accounts, public.transactions, public.budgets to authenticated;
