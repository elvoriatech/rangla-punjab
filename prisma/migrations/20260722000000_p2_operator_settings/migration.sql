-- P2-1: operator (deploy-level) settings.
--  · A single-row table holding this deploy's operator-tunable knobs:
--    fee mode / basis points / minimum-order threshold + the site
--    on/off kill switch.
--  · Not tenant-scoped — one deploy serves one operator — so no
--    tenant_id and no RLS policy (RLS is disabled on this deploy's DB;
--    see BACKLOG "Settled decisions").
--  · Pinned to a fixed id ('singleton') so there is always exactly one
--    row; seeded here with the agreed defaults (percentage / 500 bp /
--    €20 threshold / active).

CREATE TYPE "FeeMode" AS ENUM ('upfront', 'percentage');

CREATE TABLE operator_settings (
  id            text        PRIMARY KEY DEFAULT 'singleton',
  fee_mode      "FeeMode"   NOT NULL DEFAULT 'percentage',
  fee_bp        int         NOT NULL DEFAULT 500,
  fee_min_cents int         NOT NULL DEFAULT 2000,
  site_active   boolean     NOT NULL DEFAULT true,
  "createdAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   timestamp(3) NOT NULL
);

INSERT INTO operator_settings (id, "updatedAt") VALUES ('singleton', CURRENT_TIMESTAMP);
