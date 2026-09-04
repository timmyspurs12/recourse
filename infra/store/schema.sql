-- Recourse — relational schema.
--
-- The shipped MVP persists through infra/store/json-store.ts, which uses the
-- same entities, keys and constraints as this DDL. This file is the migration
-- target: pointing the RecourseStore port at Postgres is a driver swap, not a
-- redesign. The constraints below are the ones the domain relies on, so they
-- are expressed in the database rather than only in application code.

CREATE TYPE order_state AS ENUM (
  'OFFERED','ACCEPTED','ESCROWED','DELIVERED','VERIFICATION_PENDING','FULFILLED',
  'DISPUTED','ADJUDICATING','BUYER_WON','MERCHANT_WON','REFUNDED','RELEASED','CANCELLED'
);

CREATE TYPE settlement_outcome AS ENUM ('RELEASED','REFUNDED');
CREATE TYPE term_evaluation   AS ENUM ('DETERMINISTIC','SEMANTIC');
CREATE TYPE check_result      AS ENUM ('PASS','BREACH','INDETERMINATE');

-- Handle -> signing key. REGISTERED bindings are declared by an operator;
-- TOFU bindings are established by the first signed request from a handle.
CREATE TABLE agents (
  handle    TEXT PRIMARY KEY,
  address   TEXT NOT NULL,
  source    TEXT NOT NULL CHECK (source IN ('REGISTERED','TOFU')),
  bound_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE orders (
  id                      TEXT PRIMARY KEY,              -- RC-000042
  state                   order_state NOT NULL,
  buyer_handle            TEXT NOT NULL,
  merchant_handle         TEXT NOT NULL,
  resource_name           TEXT NOT NULL,
  resource_type           TEXT NOT NULL,
  amount                  NUMERIC(20,6) NOT NULL CHECK (amount > 0),
  currency                TEXT NOT NULL,
  rail                    TEXT NOT NULL,
  origin                  TEXT NOT NULL,
  delivery_deadline       TIMESTAMPTZ NOT NULL,
  recourse_window_ends_at TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL,
  updated_at              TIMESTAMPTZ NOT NULL
);

-- One agreement per order, frozen once locked.
CREATE TABLE agreements (
  id         TEXT PRIMARY KEY,
  order_id   TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  document   JSONB NOT NULL,
  hash       TEXT NOT NULL,
  locked_at  TIMESTAMPTZ
);

CREATE TABLE agreement_terms (
  agreement_id TEXT NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
  term_id      TEXT NOT NULL,
  label        TEXT NOT NULL,
  operator     TEXT NOT NULL,
  expected     TEXT NOT NULL,
  unit         TEXT,
  mandatory    BOOLEAN NOT NULL,
  evaluation   term_evaluation NOT NULL,
  PRIMARY KEY (agreement_id, term_id)
);

CREATE TABLE payments (
  id                     TEXT PRIMARY KEY,
  order_id               TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  rail                   TEXT NOT NULL,
  amount                 NUMERIC(20,6) NOT NULL,
  currency               TEXT NOT NULL,
  escrow                 TEXT NOT NULL,
  -- Replay protection: a rail authorization can never be spent twice.
  reference              TEXT NOT NULL UNIQUE,
  authorization_verified BOOLEAN NOT NULL,
  payer                  TEXT NOT NULL,
  payee                  TEXT NOT NULL,
  network                TEXT NOT NULL,
  transaction_hash       TEXT,
  execution              TEXT NOT NULL,
  initiated_at           TIMESTAMPTZ NOT NULL,
  confirmed_at           TIMESTAMPTZ
);

CREATE TABLE deliveries (
  id                 TEXT PRIMARY KEY,
  order_id           TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  statement          TEXT NOT NULL,
  artifact_url       TEXT,
  artifact_hash      TEXT NOT NULL,
  assertions         JSONB NOT NULL,
  evidence_hash      TEXT NOT NULL,
  unavailable_reason TEXT,
  submitted_at       TIMESTAMPTZ NOT NULL
);

CREATE TABLE evidence (
  id              TEXT PRIMARY KEY,
  delivery_id     TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  idx             INTEGER NOT NULL,
  kind            TEXT NOT NULL,
  source          TEXT NOT NULL,
  source_age_days INTEGER,
  checksum        TEXT NOT NULL,
  submitted_at    TIMESTAMPTZ NOT NULL,
  UNIQUE (delivery_id, idx)
);

CREATE TABLE verifications (
  order_id           TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  engine             TEXT NOT NULL,
  outcome            TEXT NOT NULL,
  checks             JSONB NOT NULL,
  semantic_questions JSONB NOT NULL,
  breached_term_ids  TEXT[] NOT NULL,
  executed_at        TIMESTAMPTZ NOT NULL
);

-- One open dispute per order.
CREATE TABLE disputes (
  id                 TEXT PRIMARY KEY,
  order_id           TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  claim              TEXT NOT NULL,
  claimed_remedy     TEXT NOT NULL,
  status             TEXT NOT NULL,
  opened_by          TEXT NOT NULL,
  contested_term_ids TEXT[] NOT NULL,
  opened_at          TIMESTAMPTZ NOT NULL
);

CREATE TABLE adjudications (
  id               TEXT PRIMARY KEY,
  dispute_id       TEXT NOT NULL UNIQUE REFERENCES disputes(id) ON DELETE CASCADE,
  order_id         TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  forum            TEXT NOT NULL,
  network          TEXT,
  contract_address TEXT,
  transaction_hash TEXT,
  network_status   TEXT,
  votes            JSONB,
  status           TEXT NOT NULL,
  question         TEXT NOT NULL,
  inputs_hash      TEXT NOT NULL,
  ruling           JSONB,
  failure_reason   TEXT,
  submitted_at     TIMESTAMPTZ NOT NULL,
  finalized_at     TIMESTAMPTZ
);

-- The core safety invariant: at most one settlement per order, so RELEASE and
-- REFUND can never both execute. The idempotency key makes retries harmless.
CREATE TABLE settlements (
  id               TEXT PRIMARY KEY,
  order_id         TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  outcome          settlement_outcome NOT NULL,
  amount           NUMERIC(20,6) NOT NULL,
  currency         TEXT NOT NULL,
  from_party       TEXT NOT NULL,
  to_party         TEXT NOT NULL,
  reason           TEXT NOT NULL,
  idempotency_key  TEXT NOT NULL UNIQUE,
  rail             TEXT NOT NULL,
  execution        TEXT NOT NULL,
  transaction_hash TEXT,
  executed_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE events (
  id       TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type     TEXT NOT NULL,
  state    order_state NOT NULL,
  phase    TEXT NOT NULL,
  summary  TEXT NOT NULL,
  detail   JSONB,
  at       TIMESTAMPTZ NOT NULL
);

CREATE INDEX events_order_at_idx  ON events (order_id, at);
CREATE INDEX orders_state_idx     ON orders (state);
CREATE INDEX disputes_status_idx  ON disputes (status);
