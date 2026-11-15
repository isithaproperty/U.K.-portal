begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Authorized draft/review capability only. Final invoice issue remains blocked.
update private.client_invoice_configuration set writes_enabled=true,issuing_enabled=false where singleton;
commit;
