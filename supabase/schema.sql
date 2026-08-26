create table if not exists public.energy_log (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  va numeric, aa numeric, wa numeric,
  vb numeric, ab numeric, wb numeric,
  vc numeric, ac numeric, wc numeric,
  w_total numeric,
  fwd_kwh numeric,
  rev_kwh numeric,
  freq numeric
);
create index if not exists energy_log_ts_idx on public.energy_log (ts desc);
alter table public.energy_log enable row level security;
create table if not exists public.energy_daily (
  day date primary key,
  fwd_start numeric not null,
  rev_start numeric not null,
  created_at timestamptz default now()
);
alter table public.energy_daily enable row level security;

-- potencia instantanea de geracao registrada junto com o medidor (v1.3+)
alter table public.energy_log add column if not exists gen_w numeric;

-- cache compartilhado entre instancias da Edge Function (v1.5+)
-- necessario porque cada requisicao pode cair numa instancia diferente,
-- entao cache em memoria nao funciona
create table if not exists public.kv (
  k text primary key,
  v jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.kv enable row level security;
