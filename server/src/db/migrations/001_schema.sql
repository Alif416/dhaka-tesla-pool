CREATE TYPE user_role       AS ENUM ('PASSENGER', 'DRIVER');
CREATE TYPE ride_status     AS ENUM ('REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED');
CREATE TYPE cancel_reason   AS ENUM ('PASSENGER_CANCELLED', 'PASSENGER_NO_SHOW');
CREATE TYPE pool_status     AS ENUM ('ACCEPTED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED');
CREATE TYPE left_reason     AS ENUM ('PASSENGER_CANCELLED', 'PASSENGER_NO_SHOW', 'DRIVER_CANCELLED_POOL', 'COMPLETED', 'DRIVER_FORCE_ENDED');
CREATE TYPE payment_status  AS ENUM ('PENDING', 'CASH_COLLECTED');
CREATE TYPE ride_event_type AS ENUM (
  'REQUESTED', 'MATCHED', 'QUOTE_UPDATED', 'REQUEUED', 'DRIVER_ARRIVED', 'PASSENGER_NO_SHOW',
  'PASSENGER_CANCELLED', 'STARTED', 'COMPLETED', 'PASSENGER_SELF_COMPLETED', 'DRIVER_FORCE_ENDED',
  'CASH_COLLECTED');

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          user_role NOT NULL,
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT users_name_length CHECK (length(name) BETWEEN 1 AND 80)
);

CREATE TABLE vehicles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       UUID NOT NULL REFERENCES users(id),
  name            TEXT NOT NULL,
  registration_no TEXT NOT NULL,
  capacity        INTEGER NOT NULL,
  online          BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vehicles_driver_id_key UNIQUE (driver_id),
  CONSTRAINT vehicles_registration_no_key UNIQUE (registration_no),
  CONSTRAINT vehicles_capacity_positive CHECK (capacity > 0)
);

CREATE TABLE zones (
  id       SMALLINT PRIMARY KEY,
  name     TEXT NOT NULL,
  corridor TEXT NOT NULL,
  position INTEGER NOT NULL,
  CONSTRAINT zones_name_key UNIQUE (name),
  CONSTRAINT zones_corridor_position_key UNIQUE (corridor, position),
  CONSTRAINT zones_position_positive CHECK (position > 0)
);

-- Cross-corridor pairs only. Same-corridor distance always comes from positions.
CREATE TABLE zone_distances (
  from_zone_id   SMALLINT NOT NULL REFERENCES zones(id),
  to_zone_id     SMALLINT NOT NULL REFERENCES zones(id),
  distance_units INTEGER NOT NULL,
  PRIMARY KEY (from_zone_id, to_zone_id),
  CONSTRAINT zone_distances_pair_order CHECK (from_zone_id < to_zone_id),
  CONSTRAINT zone_distances_units_positive CHECK (distance_units > 0)
);

CREATE TABLE ride_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id        UUID NOT NULL REFERENCES users(id),
  pickup_zone_id      SMALLINT NOT NULL REFERENCES zones(id),
  destination_zone_id SMALLINT NOT NULL REFERENCES zones(id),
  seats               INTEGER NOT NULL,
  distance_units      INTEGER NOT NULL,
  solo_fare_paisa     INTEGER NOT NULL,
  quoted_fare_paisa   INTEGER NOT NULL,
  status              ride_status NOT NULL DEFAULT 'REQUESTED',
  cancel_reason       cancel_reason,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ride_requests_seats_positive CHECK (seats > 0),
  CONSTRAINT ride_requests_distance_positive CHECK (distance_units > 0),
  CONSTRAINT ride_requests_solo_fare_positive CHECK (solo_fare_paisa > 0),
  CONSTRAINT ride_requests_quoted_fare_positive CHECK (quoted_fare_paisa > 0),
  CONSTRAINT ride_requests_pickup_ne_destination CHECK (pickup_zone_id <> destination_zone_id),
  CONSTRAINT ride_requests_quoted_lte_solo CHECK (quoted_fare_paisa <= solo_fare_paisa),
  CONSTRAINT ride_requests_cancel_reason_matches_status CHECK ((status = 'CANCELLED') = (cancel_reason IS NOT NULL))
);
CREATE UNIQUE INDEX ride_requests_one_active_per_passenger
  ON ride_requests (passenger_id)
  WHERE status IN ('REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED');
CREATE INDEX ride_requests_passenger_created_idx ON ride_requests (passenger_id, created_at DESC);
CREATE INDEX ride_requests_open_idx ON ride_requests (pickup_zone_id, created_at) WHERE status = 'REQUESTED';

CREATE TABLE pools (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id   UUID NOT NULL REFERENCES vehicles(id),
  status       pool_status NOT NULL DEFAULT 'ACCEPTED',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  arrived_at   TIMESTAMPTZ,
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  CONSTRAINT pools_cancelled_at_matches_status CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  CONSTRAINT pools_completed_at_matches_status CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX pools_one_active_per_vehicle
  ON pools (vehicle_id) WHERE status IN ('ACCEPTED', 'DRIVER_ARRIVED', 'STARTED');
CREATE INDEX pools_vehicle_created_idx ON pools (vehicle_id, created_at DESC);

CREATE TABLE pool_members (
  pool_id         UUID NOT NULL REFERENCES pools(id),
  ride_request_id UUID NOT NULL REFERENCES ride_requests(id),
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at         TIMESTAMPTZ,
  left_reason     left_reason,
  PRIMARY KEY (pool_id, ride_request_id),
  CONSTRAINT pool_members_left_pair CHECK ((left_at IS NULL) = (left_reason IS NULL))
);
CREATE UNIQUE INDEX pool_members_one_active_per_ride
  ON pool_members (ride_request_id) WHERE left_at IS NULL;
CREATE INDEX pool_members_ride_idx ON pool_members (ride_request_id);

CREATE TABLE payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_request_id     UUID NOT NULL REFERENCES ride_requests(id),
  pool_id             UUID NOT NULL REFERENCES pools(id),
  uncapped_fare_paisa INTEGER NOT NULL,
  final_fare_paisa    INTEGER NOT NULL,
  subsidy_paisa       INTEGER GENERATED ALWAYS AS (uncapped_fare_paisa - final_fare_paisa) STORED,
  status              payment_status NOT NULL DEFAULT 'PENDING',
  cash_collected_at   TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payments_ride_request_id_key UNIQUE (ride_request_id),
  CONSTRAINT payments_uncapped_fare_positive CHECK (uncapped_fare_paisa > 0),
  CONSTRAINT payments_final_fare_positive CHECK (final_fare_paisa > 0),
  CONSTRAINT payments_final_lte_uncapped CHECK (final_fare_paisa <= uncapped_fare_paisa),
  CONSTRAINT payments_cash_collected_matches_status CHECK ((status = 'CASH_COLLECTED') = (cash_collected_at IS NOT NULL))
);
CREATE INDEX payments_pool_idx ON payments (pool_id);

CREATE TABLE ride_events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_request_id UUID NOT NULL REFERENCES ride_requests(id),
  pool_id         UUID REFERENCES pools(id),
  actor_id        UUID NOT NULL REFERENCES users(id),
  event_type      ride_event_type NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ride_events_ride_idx ON ride_events (ride_request_id, created_at, id);

-- Append-only history: rows can be inserted, never changed or removed.
CREATE FUNCTION ride_events_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ride_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ride_events_append_only
  BEFORE UPDATE OR DELETE ON ride_events
  FOR EACH ROW EXECUTE FUNCTION ride_events_reject_change();
