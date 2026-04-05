-- Run this in Supabase SQL Editor once.

create extension if not exists pgcrypto;
create extension if not exists vector;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists sessions_user_idx on sessions(user_id);
create index if not exists sessions_expires_idx on sessions(expires_at);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null default 'New Chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversations_user_idx on conversations(user_id);
create index if not exists conversations_updated_idx on conversations(updated_at desc);

create table if not exists messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  model_id text,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_idx on messages(conversation_id, id);

create table if not exists global_stats (
  id int primary key default 1,
  total_calls bigint not null default 0,
  tavily_calls bigint not null default 0,
  model_counts jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint global_stats_singleton check (id = 1)
);

alter table global_stats
add column if not exists tavily_calls bigint not null default 0;

insert into global_stats (id) values (1)
on conflict (id) do nothing;

create or replace function increment_global_call(match_model_id text)
returns table (
  total_calls bigint,
  model_counts jsonb,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  insert into global_stats (id) values (1)
  on conflict (id) do nothing;

  update global_stats
  set
    total_calls = global_stats.total_calls + 1,
    model_counts = jsonb_set(
      global_stats.model_counts,
      array[match_model_id],
      to_jsonb(coalesce((global_stats.model_counts ->> match_model_id)::bigint, 0) + 1),
      true
    ),
    updated_at = now()
  where id = 1
  returning global_stats.total_calls, global_stats.model_counts, global_stats.updated_at;
$$;

create or replace function increment_tavily_call()
returns table (
  total_calls bigint,
  tavily_calls bigint,
  model_counts jsonb,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  insert into global_stats (id) values (1)
  on conflict (id) do nothing;

  update global_stats
  set
    tavily_calls = global_stats.tavily_calls + 1,
    updated_at = now()
  where id = 1
  returning global_stats.total_calls, global_stats.tavily_calls, global_stats.model_counts, global_stats.updated_at;
$$;

create table if not exists memory_chunks (
  id bigint generated always as identity primary key,
  user_id uuid not null references users(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  message_id bigint not null references messages(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  chunk_text text not null,
  embedding vector,
  created_at timestamptz not null default now()
);

create index if not exists memory_chunks_user_idx on memory_chunks(user_id);
create index if not exists memory_chunks_conversation_idx on memory_chunks(conversation_id);
create index if not exists memory_chunks_message_idx on memory_chunks(message_id);

create table if not exists memory_summaries (
  id bigint generated always as identity primary key,
  user_id uuid not null references users(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  upto_message_id bigint not null,
  summary_text text not null,
  embedding vector,
  created_at timestamptz not null default now()
);

create index if not exists memory_summaries_user_idx on memory_summaries(user_id);
create index if not exists memory_summaries_conversation_idx on memory_summaries(conversation_id);
create index if not exists memory_summaries_upto_idx on memory_summaries(upto_message_id);

create or replace function match_memory_chunks(
  query_embedding vector,
  match_user_id uuid,
  match_conversation_ids uuid[] default null,
  match_count int default 8
)
returns table (
  id bigint,
  conversation_id uuid,
  role text,
  chunk_text text,
  created_at timestamptz,
  similarity float
)
language sql
stable
set search_path = public
as $$
  select
    mc.id,
    mc.conversation_id,
    mc.role,
    mc.chunk_text,
    mc.created_at,
    (mc.embedding <=> query_embedding) as similarity
  from memory_chunks mc
  where mc.user_id = match_user_id
    and mc.embedding is not null
    and (match_conversation_ids is null or mc.conversation_id = any(match_conversation_ids))
  order by mc.embedding <=> query_embedding
  limit greatest(1, least(match_count, 40));
$$;
