#!/usr/bin/env bash
set -euo pipefail
# Disposable synthetic databases only; never accepts a live database URL.
review_container="london-review-verification"
docker run --name "$review_container" -e POSTGRES_PASSWORD=local-review-only -d postgres:17-alpine >/dev/null
trap 'docker rm -f "$review_container" >/dev/null' EXIT
for attempt in {1..100}; do if docker exec "$review_container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi; sleep 0.2; done
sql(){ docker exec -i "$review_container" psql -q -v ON_ERROR_STOP=1 -U postgres -d "${2:-postgres}" < "$1"; }
sql tests/sql/management-review-bootstrap.sql
sql supabase/management_review.sql
sql tests/sql/management-review-assertions.sql
sql tests/sql/management-financial-bootstrap.sql
sql supabase/service_charges.sql
sql supabase/automatic_invoice_numbers.sql
sql tests/sql/management-financial-assertions.sql
sql tests/sql/supplier-settlements-bootstrap.sql
sql supabase/supplier_settlements.sql
sql tests/sql/supplier-settlements-assertions.sql
sql tests/sql/management-dispatch-bootstrap.sql
sql supabase/management_dispatch.sql
sql supabase/communication_delivery.sql
sql tests/sql/management-dispatch-assertions.sql
docker exec "$review_container" createdb -U postgres standing_orders_test
sql tests/sql/standing-orders-bootstrap.sql standing_orders_test
sql supabase/service_charges.sql standing_orders_test
sql supabase/automatic_invoice_numbers.sql standing_orders_test
sql supabase/bank_reconciliation.sql standing_orders_test
sql supabase/standing_orders.sql standing_orders_test
sql tests/sql/standing-orders-assertions.sql standing_orders_test
