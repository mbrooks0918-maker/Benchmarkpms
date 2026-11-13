-- Web push subscriptions: one row per device a user has enabled alerts on.
-- Applied to project ukrqgzpsoytafxafsoek. The send-pm-alert edge function
-- reads across users via the service role (bypasses RLS).
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "own subs read" on public.push_subscriptions
  for select to authenticated using (auth.uid() = user_id);
create policy "own subs insert" on public.push_subscriptions
  for insert to authenticated with check (auth.uid() = user_id);
create policy "own subs update" on public.push_subscriptions
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own subs delete" on public.push_subscriptions
  for delete to authenticated using (auth.uid() = user_id);
