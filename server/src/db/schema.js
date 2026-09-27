import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Mirror of migrations/*.sql. The SQL is the source of truth; change it first, then this file.

export const userRole = pgEnum('user_role', ['PASSENGER', 'DRIVER']);
export const rideStatus = pgEnum('ride_status', [
  'REQUESTED',
  'MATCHED',
  'DRIVER_ARRIVED',
  'STARTED',
  'COMPLETED',
  'CANCELLED',
]);
export const cancelReason = pgEnum('cancel_reason', ['PASSENGER_CANCELLED', 'PASSENGER_NO_SHOW']);
export const poolStatus = pgEnum('pool_status', [
  'ACCEPTED',
  'DRIVER_ARRIVED',
  'STARTED',
  'COMPLETED',
  'CANCELLED',
]);
export const leftReason = pgEnum('left_reason', [
  'PASSENGER_CANCELLED',
  'PASSENGER_NO_SHOW',
  'DRIVER_CANCELLED_POOL',
  'COMPLETED',
  'DRIVER_FORCE_ENDED',
]);
export const paymentStatus = pgEnum('payment_status', ['PENDING', 'CASH_COLLECTED']);
export const rideEventType = pgEnum('ride_event_type', [
  'REQUESTED',
  'MATCHED',
  'QUOTE_UPDATED',
  'REQUEUED',
  'DRIVER_ARRIVED',
  'PASSENGER_NO_SHOW',
  'PASSENGER_CANCELLED',
  'STARTED',
  'COMPLETED',
  'PASSENGER_SELF_COMPLETED',
  'DRIVER_FORCE_ENDED',
  'CASH_COLLECTED',
]);

const timestamptz = (name) => timestamp(name, { withTimezone: true });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: userRole('role').notNull(),
  name: text('name').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const vehicles = pgTable('vehicles', {
  id: uuid('id').primaryKey().defaultRandom(),
  driverId: uuid('driver_id')
    .notNull()
    .references(() => users.id),
  name: text('name').notNull(),
  registrationNo: text('registration_no').notNull(),
  capacity: integer('capacity').notNull(),
  online: boolean('online').notNull().default(false),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const zones = pgTable('zones', {
  id: smallint('id').primaryKey(),
  name: text('name').notNull(),
  corridor: text('corridor').notNull(),
  position: integer('position').notNull(),
});

export const zoneDistances = pgTable(
  'zone_distances',
  {
    fromZoneId: smallint('from_zone_id')
      .notNull()
      .references(() => zones.id),
    toZoneId: smallint('to_zone_id')
      .notNull()
      .references(() => zones.id),
    distanceUnits: integer('distance_units').notNull(),
  },
  (table) => [primaryKey({ columns: [table.fromZoneId, table.toZoneId] })],
);

export const rideRequests = pgTable(
  'ride_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    passengerId: uuid('passenger_id')
      .notNull()
      .references(() => users.id),
    pickupZoneId: smallint('pickup_zone_id')
      .notNull()
      .references(() => zones.id),
    destinationZoneId: smallint('destination_zone_id')
      .notNull()
      .references(() => zones.id),
    seats: integer('seats').notNull(),
    distanceUnits: integer('distance_units').notNull(),
    soloFarePaisa: integer('solo_fare_paisa').notNull(),
    quotedFarePaisa: integer('quoted_fare_paisa').notNull(),
    status: rideStatus('status').notNull().default('REQUESTED'),
    cancelReason: cancelReason('cancel_reason'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('ride_requests_one_active_per_passenger')
      .on(table.passengerId)
      .where(sql`${table.status} IN ('REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED')`),
    index('ride_requests_passenger_created_idx').on(table.passengerId, table.createdAt.desc()),
    index('ride_requests_open_idx')
      .on(table.pickupZoneId, table.createdAt)
      .where(sql`${table.status} = 'REQUESTED'`),
  ],
);

export const pools = pgTable(
  'pools',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    status: poolStatus('status').notNull().default('ACCEPTED'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    arrivedAt: timestamptz('arrived_at'),
    startedAt: timestamptz('started_at'),
    completedAt: timestamptz('completed_at'),
    cancelledAt: timestamptz('cancelled_at'),
  },
  (table) => [
    uniqueIndex('pools_one_active_per_vehicle')
      .on(table.vehicleId)
      .where(sql`${table.status} IN ('ACCEPTED', 'DRIVER_ARRIVED', 'STARTED')`),
    index('pools_vehicle_created_idx').on(table.vehicleId, table.createdAt.desc()),
  ],
);

export const poolMembers = pgTable(
  'pool_members',
  {
    poolId: uuid('pool_id')
      .notNull()
      .references(() => pools.id),
    rideRequestId: uuid('ride_request_id')
      .notNull()
      .references(() => rideRequests.id),
    joinedAt: timestamptz('joined_at').notNull().defaultNow(),
    leftAt: timestamptz('left_at'),
    leftReason: leftReason('left_reason'),
  },
  (table) => [
    primaryKey({ columns: [table.poolId, table.rideRequestId] }),
    uniqueIndex('pool_members_one_active_per_ride')
      .on(table.rideRequestId)
      .where(sql`${table.leftAt} IS NULL`),
    index('pool_members_ride_idx').on(table.rideRequestId),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rideRequestId: uuid('ride_request_id')
      .notNull()
      .references(() => rideRequests.id),
    poolId: uuid('pool_id')
      .notNull()
      .references(() => pools.id),
    uncappedFarePaisa: integer('uncapped_fare_paisa').notNull(),
    finalFarePaisa: integer('final_fare_paisa').notNull(),
    // Generated by the database. Drizzle omits generated columns from inserts and updates.
    subsidyPaisa: integer('subsidy_paisa').generatedAlwaysAs(
      sql`uncapped_fare_paisa - final_fare_paisa`,
    ),
    status: paymentStatus('status').notNull().default('PENDING'),
    cashCollectedAt: timestamptz('cash_collected_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [index('payments_pool_idx').on(table.poolId)],
);

export const rideEvents = pgTable(
  'ride_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    rideRequestId: uuid('ride_request_id')
      .notNull()
      .references(() => rideRequests.id),
    poolId: uuid('pool_id').references(() => pools.id),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    eventType: rideEventType('event_type').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [index('ride_events_ride_idx').on(table.rideRequestId, table.createdAt, table.id)],
);
