-- Review and install after resident_communications.sql and management_review.sql.
-- The service-only sender records the exact logical request before contacting the provider.
create table public.communication_delivery_requests(
 request_id uuid primary key,
 sent_by text not null,
 payload_hash text not null,
 delivery_payload jsonb not null check(jsonb_typeof(delivery_payload)='object'),
 status text not null default 'processing' check(status in ('processing','sent')),
 recipient_count integer not null check(recipient_count>0),
 block_count integer not null check(block_count>0),
 created_at timestamptz not null default now(),
 completed_at timestamptz
);
alter table public.communication_delivery_requests enable row level security;
revoke all on public.communication_delivery_requests from public,anon,authenticated;
grant select,insert,update on public.communication_delivery_requests to service_role;
alter table public.communications add column delivery_request_id uuid references public.communication_delivery_requests(request_id);
create unique index communications_delivery_request_idx on public.communications(delivery_request_id) where delivery_request_id is not null;
