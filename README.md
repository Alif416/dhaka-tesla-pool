# RidePool

Pooled Tesla rides in Dhaka. The full README is written in the hardening unit; this covers setup only.

## Run

```
cp .env.example .env
docker compose up
```

Then `curl localhost:3000/api/health`.

## Test

Tests run against a real PostgreSQL database named `ridepool_test` (created by the compose `db` service).

```
docker compose up -d db
cd server && npm install && npm test
```

Set `TEST_DATABASE_URL` to use a different database (default `postgres://ridepool:ridepool@localhost:5432/ridepool_test`).
