<div align="center">

<img src="https://raw.githubusercontent.com/Bin-E-Commerce/Bin-E-Commerce-UI-Web/main/public/images/logo/logo_icon.png" alt="Bin E-Commerce" width="112" />

# Shipping Service

### Server-side shipment orchestration for BIN E-Commerce

[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![NestJS 11](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Kafka](https://img.shields.io/badge/Apache%20Kafka-events-231F20?logo=apache-kafka&logoColor=white)](https://kafka.apache.org/)

[Overview](#overview) · [Quick start](#quick-start) · [API](#api-surface) · [Architecture](#architecture)

</div>

---

> [!IMPORTANT]
> This service currently targets **GHN Test** only. Keep `GHN_TOKEN` and `GHN_SHOP_ID` on the server, never commit them, and never expose them to the frontend. The service makes network calls to GHN and to internal Order/Seller services, writes shipment data to PostgreSQL, and publishes status events to Kafka.

## Overview

Checkout, shipment creation, tracking, cancellation, label printing, and carrier callbacks need one consistent boundary. This service owns that boundary for BIN E-Commerce and keeps carrier credentials and provider-specific payloads away from the browser and other domains.

The current adapter is `GHN_TEST`. It validates GHN address codes, calculates shipping fees, creates orders, synchronizes provider status, accepts webhooks, prints labels, and stores an append-only shipment timeline.

## What it provides

- GHN province, district, and ward master data with one-hour caching and in-flight request deduplication.
- Shipping quotes using weight, package dimensions, declared value, COD amount, and GHN address codes.
- Idempotent shipment creation using a stable `client_order_code`.
- Seller actions: create, refresh, cancel, advance a demo shipment, and download a label.
- Customer tracking with current location, route points, status, and shipment events.
- GHN webhook processing and scheduled polling for non-terminal shipments.
- PostgreSQL persistence for shipments and shipment events.
- Kafka publication through a dedicated `src/kafka` module.

## Quick start

### Prerequisites

- Node.js 20 or newer
- npm 10 or newer
- PostgreSQL
- Kafka, when event publishing is required
- A GHN Test token and numeric shop ID

### Install

From the monorepo root:

```bash
npm install
cd services/shipping-service
cp .env.example .env
```

On PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

Fill in the GHN credentials and local infrastructure settings in `.env`. The adapter rejects production GHN URLs and formatted shop IDs such as `123456 - 9876543210`.

### Run locally

Start the shared infrastructure from the monorepo root when needed:

```bash
docker compose --env-file infra/docker/.env -f infra/docker/docker-compose.infra.yml up -d
```

Then start this service:

```bash
cd services/shipping-service
npm run dev
```

The service listens on `http://localhost:3012` by default. In development, Swagger is available at `http://localhost:3012/api/docs`.

## Configuration

| Variable                 | Required | Purpose                                                                                      |
| ------------------------ | -------- | -------------------------------------------------------------------------------------------- |
| `PORT`                   | No       | HTTP port. Defaults to `3012`.                                                               |
| `POSTGRES_HOST`          | Yes      | PostgreSQL host.                                                                             |
| `POSTGRES_PORT`          | Yes      | PostgreSQL port.                                                                             |
| `POSTGRES_USER`          | Yes      | PostgreSQL user.                                                                             |
| `POSTGRES_PASSWORD`      | Yes      | PostgreSQL password.                                                                         |
| `POSTGRES_DB`            | Yes      | Shipping database name.                                                                      |
| `KAFKA_BROKERS`          | No       | Comma-separated Kafka brokers.                                                               |
| `KAFKA_CLIENT_ID`        | No       | Kafka client ID.                                                                             |
| `KAFKA_GROUP_ID`         | No       | Kafka consumer group setting reserved for service integration.                               |
| `ORDER_SERVICE_URL`      | Yes      | Internal Order Service URL.                                                                  |
| `SELLER_SERVICE_URL`     | Yes      | Internal Seller Service URL.                                                                 |
| `INTERNAL_SERVICE_TOKEN` | Yes      | Shared secret for internal shipment routes.                                                  |
| `GHN_BASE_URL`           | Yes      | Must be `https://dev-online-gateway.ghn.vn` in the current phase.                            |
| `GHN_TOKEN`              | Yes      | GHN Test API token.                                                                          |
| `GHN_SHOP_ID`            | Yes      | Positive numeric GHN shop ID.                                                                |
| `GHN_CLIENT_ID`          | No       | Kept for future GHN account/webhook integration; not used by the current fee/create adapter. |
| `GHN_SERVICE_TYPE_ID`    | No       | GHN service type. Defaults to `2`.                                                           |
| `GHN_REQUEST_TIMEOUT_MS` | No       | Upstream timeout. Defaults to `10000`.                                                       |
| `SHIPPING_DEMO_MODE`     | No       | Enables the demo route-advance action. Keep it `false` in production.                        |
| `MAP_DEFAULT_LATITUDE`   | No       | Fallback map latitude.                                                                       |
| `MAP_DEFAULT_LONGITUDE`  | No       | Fallback map longitude.                                                                      |

## API surface

The application uses the global prefix `/api` and URI version `v1`.

### Health and documentation

| Method | Endpoint         | Purpose                        |
| ------ | ---------------- | ------------------------------ |
| `GET`  | `/api/v1/health` | Lightweight liveness check.    |
| `GET`  | `/api/docs`      | Swagger UI outside production. |

### GHN address master data

These endpoints are owned by Shipping Service. The frontend does not call GHN directly.

| Method | Endpoint                                              | Purpose                        |
| ------ | ----------------------------------------------------- | ------------------------------ |
| `GET`  | `/api/v1/shipping/locations/provinces`                | List GHN provinces.            |
| `GET`  | `/api/v1/shipping/locations/districts?provinceId=202` | List districts for a province. |
| `GET`  | `/api/v1/shipping/locations/wards?districtId=1442`    | List wards for a district.     |

### Internal order orchestration

These endpoints require `x-internal-service-token` matching `INTERNAL_SERVICE_TOKEN`.

| Method | Endpoint                                        | Purpose                                                                   |
| ------ | ----------------------------------------------- | ------------------------------------------------------------------------- |
| `POST` | `/api/v1/internal/shipments/quotes`             | Calculate a quote using the shop pickup address and customer GHN address. |
| `GET`  | `/api/v1/internal/shipments/:shipmentId`        | Read an internal shipment.                                                |
| `POST` | `/api/v1/internal/shipments/:shipmentId/sync`   | Synchronize provider status.                                              |
| `POST` | `/api/v1/internal/shipments/:shipmentId/cancel` | Cancel a shipment through GHN.                                            |

### Seller shipment actions

These endpoints use the authenticated seller context forwarded by the API Gateway.

| Method | Endpoint                                               | Purpose                                   |
| ------ | ------------------------------------------------------ | ----------------------------------------- |
| `POST` | `/api/v1/seller/orders/:orderId/shipment`              | Create a shipment for the seller's order. |
| `GET`  | `/api/v1/seller/orders/:orderId/shipment`              | Read the seller's shipment.               |
| `POST` | `/api/v1/seller/orders/:orderId/shipment/refresh`      | Refresh status from GHN.                  |
| `POST` | `/api/v1/seller/orders/:orderId/shipment/cancel`       | Cancel before carrier pickup.             |
| `POST` | `/api/v1/seller/orders/:orderId/shipment/demo/advance` | Skip to the next demo route stage.        |
| `GET`  | `/api/v1/seller/orders/:orderId/shipment/label`        | Download a PDF or printable HTML label.   |

### Customer tracking and GHN callback

| Method | Endpoint                           | Purpose                                       |
| ------ | ---------------------------------- | --------------------------------------------- |
| `GET`  | `/api/v1/orders/:orderId/tracking` | Read tracking for the authenticated customer. |
| `POST` | `/api/v1/internal/webhooks/ghn`    | Receive and apply a GHN status callback.      |

## Architecture

```text
Order Service / Seller Service / Customer
                    |
                    v
              API Gateway
                    |
                    v
          Shipping Service :3012
          |        |       |       |
          |        |       |       +--> Kafka events
          |        |       +----------> PostgreSQL
          |        +------------------> Order/Seller clients
          +---------------------------> GHN Test API
```

The service keeps the application boundary separate from infrastructure and provider code:

```text
src/
├── database/
│   ├── entities/       # TypeORM persistence models
│   ├── enums/          # Database-facing canonical status enum
│   └── migrations/     # Explicit PostgreSQL schema changes
├── kafka/              # Producer connection and shipment event publisher
└── modules/shipping/
    ├── clients/        # GHN, Order Service, and Seller Service clients
    ├── controllers/    # HTTP boundaries
    ├── dto/             # Request validation contracts
    ├── providers/      # GHN adapter and status mapping
    ├── repositories/   # Shipment database access
    ├── services/       # Shipment state machine and orchestration
    └── types/          # Internal shipping contracts
```

### Shipment lifecycle

```text
Quote
  -> Create shipment
  -> READY_TO_SHIP
  -> PICKUP_ASSIGNED
  -> PICKED_UP
  -> IN_TRANSIT
  -> DELIVERED
```

GHN webhooks and polling both use the same state transition path. Provider statuses are normalized into canonical `ShipmentStatus` values, and unique event keys protect the timeline from duplicate callbacks.

## Data model

- `shipments` stores the provider reference, tracking ID, current canonical status, current location, route points, pickup address snapshot, and delivery estimate.
- `shipment_events` stores append-only status history, provider event keys, source, location, and timestamps.
- Historical address snapshots are preserved when a seller later changes the pickup address.
- TypeORM synchronization is disabled; schema changes must be delivered through migrations.

## GHN integration notes

The adapter uses these GHN Test endpoints:

```text
POST /shiip/public-api/v2/shipping-order/fee
POST /shiip/public-api/v2/shipping-order/create
POST /shiip/public-api/v2/shipping-order/detail
POST /shiip/public-api/v2/shipping-order/detail-by-client-code
POST /shiip/public-api/v2/switch-status/cancel
POST /shiip/public-api/v2/a5/gen-token
GET  /a5/public-api/printA5?token=...
GET  /shiip/public-api/master-data/province
POST /shiip/public-api/master-data/district
POST /shiip/public-api/master-data/ward
```

Fee and create requests use gram weight, centimeter dimensions, GHN district IDs, and GHN ward codes. The service validates the selected address against cached GHN master data before calling fee or create APIs.

The route on the tracking map is a controlled demonstration route. GHN Test does not provide live driver GPS in this integration, so `demo/advance` exists for presentations and local workflow testing.

## Development checks

Run these commands from `services/shipping-service`:

```bash
npm run type-check
npm run type-check:test
npm run lint
npm test
npm run build
```

The unit tests cover GHN request headers and payloads, address validation, status normalization, label responses, business errors, and missing credentials.

## Related documentation

- [Monorepo README](https://github.com/Bin-E-Commerce/Bin-Ecommerce)
- [GHN shipping domain](https://github.com/Bin-E-Commerce/Bin-Ecommerce/blob/main/doc/domain/07-shipping-delivery.md)
- [GHN developer documentation](https://api.ghn.vn/home/docs/detail?id=108)

## License

This service is part of the BIN E-Commerce monorepo. Refer to the repository root for project licensing information.
