<div align="center">

<img src="https://raw.githubusercontent.com/Bin-E-Commerce/Bin-E-Commerce-UI-Web/main/public/images/logo/logo_icon.png" alt="Bin E-Commerce" width="112" />

# Shipping Service

### Demo-first shipment orchestration for Bin E-Commerce

Simulate a complete delivery journey — from pickup assignment to successful delivery — without creating a real shipment or charging a real shipping fee.

<p>
  <img alt="NestJS 11" src="https://img.shields.io/badge/NestJS-11-E0234E?style=flat-square&logo=nestjs&logoColor=white" />
  <img alt="TypeScript 5.7" src="https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img alt="PostgreSQL 16" src="https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white" />
  <img alt="Apache Kafka" src="https://img.shields.io/badge/Apache%20Kafka-events-231F20?style=flat-square&logo=apachekafka&logoColor=white" />
  <img alt="Mock GHN" src="https://img.shields.io/badge/provider-Mock%20GHN-111827?style=flat-square" />
</p>

<p>
  <a href="#overview">Overview</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#api-contract">API contract</a> ·
  <a href="#see-it-work">See it work</a>
</p>

</div>

---

> [!IMPORTANT]
> This service is intentionally demo-safe. The default provider is `mock-ghn`: it does not call GHN, create real waybills, collect shipping fees, or transmit customer data to a carrier.
>
> The service persists demo shipment state in PostgreSQL and publishes internal events through Kafka. To disable it, stop the local process or container. Demo data can be removed by resetting the service database.

## Overview

An order platform needs to show what happens after checkout: the seller prepares the parcel, a courier picks it up, the shipment moves through transit points, and the customer receives it.

Real carrier integration is not necessary for a local product demonstration. It introduces credentials, account approval, shipping fees, carrier availability and real customer addresses. Shipping Service provides the same application boundary with a deterministic Mock GHN provider, so Seller Center and Customer Web can demonstrate the complete journey safely.

The provider boundary follows the concepts exposed by GHN — shipment creation, tracking code, status transitions and callbacks — while keeping the demo implementation independent from live carrier credentials. A real GHN adapter can be added later without changing the frontend contract.

## What this service owns

| Responsibility                                | Shipping Service | Another service      |
| --------------------------------------------- | ---------------- | -------------------- |
| Shipment records and tracking codes           | Owns             | —                    |
| Shipment status history                       | Owns             | —                    |
| Demo courier position and route               | Owns             | —                    |
| Order ownership and shop scope                | —                | Order Service        |
| Seller/shop identity                          | —                | Seller Service       |
| Product names, images and package dimensions  | —                | Product Service      |
| Customer identity and saved address ownership | —                | Auth Service         |
| In-app notifications and email                | —                | Notification Service |

Shipping Service must not query another service's database. It receives the minimum required snapshot through explicit internal HTTP contracts or Kafka events.

## Quick start

### Prerequisites

- Node.js 20 or newer.
- npm 10 or newer.
- PostgreSQL 16 or newer.
- Kafka available at `localhost:29092`, or another broker configured through `.env`.

### Local setup

```powershell
cd services/shipping-service
npm install
Copy-Item .env.example .env
npm run dev
```

The planned local service endpoint is:

```text
http://localhost:3012/api/v1
```

Health check:

```powershell
curl http://localhost:3012/api/health
```

Development Swagger:

```text
http://localhost:3012/docs
```

> The service scaffold, migrations and controllers are implemented in the next delivery step. This README defines the service boundary and its demo contract first.

## Configuration

Create `.env` from `.env.example`:

| Variable                  | Required               | Default            | Purpose                                    |
| ------------------------- | ---------------------- | ------------------ | ------------------------------------------ |
| `NODE_ENV`                | No                     | `development`      | Runtime mode and Swagger visibility.       |
| `PORT`                    | No                     | `3012`             | HTTP port.                                 |
| `DATABASE_URL`            | Yes                    | —                  | PostgreSQL connection string.              |
| `DB_SYNCHRONIZE`          | No                     | `false`            | Use only with a disposable local database. |
| `KAFKA_BROKERS`           | Yes                    | `localhost:29092`  | Comma-separated Kafka brokers.             |
| `KAFKA_CLIENT_ID`         | No                     | `shipping-service` | Kafka client identifier.                   |
| `KAFKA_GROUP_ID`          | No                     | `shipping-service` | Consumer group identifier.                 |
| `SHIPPING_PROVIDER`       | No                     | `mock-ghn`         | Active provider; demo supports `mock-ghn`. |
| `DEMO_STEP_DELAY_SECONDS` | No                     | `0`                | Delay between automatic simulation steps.  |
| `WEBHOOK_SECRET`          | Yes for webhook routes | —                  | Secret for protected demo callbacks.       |
| `MAP_DEFAULT_LATITUDE`    | No                     | `10.7769`          | Fallback latitude for demo coordinates.    |
| `MAP_DEFAULT_LONGITUDE`   | No                     | `106.7009`         | Fallback longitude for demo coordinates.   |

No live GHN token, ShopId or carrier credential is required for the demo provider.

## See it work

```text
Customer places a COD order
        │
        ▼
Seller opens the order in Seller Center
        │
        ├─ Start processing
        ├─ Mark parcel ready
        └─ Create demo shipment
                │
                ▼
        GHN-DEMO-XXXXXXXX
                │
                ├─ Pickup assigned
                ├─ Courier picked up the parcel
                ├─ Shipment in transit
                └─ Delivered
                        │
                        ▼
              Customer sees timeline + map
```

Example shipment response:

```json
{
  "id": "shipment-demo-id",
  "provider": "MOCK_GHN",
  "trackingCode": "GHN-DEMO-8F3A21C9",
  "status": "IN_TRANSIT",
  "statusLabel": "In transit",
  "currentLocation": {
    "latitude": 10.7892,
    "longitude": 106.6821,
    "label": "District 3 transit hub"
  },
  "routePoints": [
    {
      "latitude": 10.8231,
      "longitude": 106.6297,
      "label": "Seller pickup point"
    },
    {
      "latitude": 10.7892,
      "longitude": 106.6821,
      "label": "District 3 transit hub"
    },
    {
      "latitude": 10.7769,
      "longitude": 106.7009,
      "label": "Customer delivery point"
    }
  ],
  "estimatedDeliveryAt": "2026-08-30T18:00:00.000Z"
}
```

## Architecture

```text
┌──────────────────────┐
│ Customer / Seller Web│
└──────────┬───────────┘
           │ authenticated request
           ▼
┌──────────────────────┐
│ API Gateway :3000    │
│ JWT + permissions     │
└──────────┬───────────┘
           │ user context + internal proxy
           ▼
┌──────────────────────┐
│ Order Service         │
│ order/shop fulfillment│
└──────────┬───────────┘
           │ create / read shipment
           ▼
┌──────────────────────────────────┐
│ Shipping Service :3012           │
│                                  │
│  Shipment application service    │
│        │                         │
│        ├─ MockGhnProvider         │
│        ├─ PostgreSQL              │
│        └─ Kafka producer          │
└────────┬─────────────────────────┘
         │ shipment.status.updated
         ├──────────────────────► Order Service
         └──────────────────────► Notification Service
                                      │
                                      ├─ in-app notification
                                      └─ customer email
```

The service is split into provider, application and infrastructure boundaries:

```text
src/
├── common/                  # Configuration, security and shared errors
├── database/                # Entities, migrations and PostgreSQL adapters
├── modules/shipping/
│   ├── controllers/         # HTTP and internal webhook boundaries
│   ├── dto/                 # Validated request contracts
│   ├── providers/           # ShippingProvider port and MockGhnProvider
│   ├── repositories/        # Shipment and event persistence
│   ├── services/            # State transitions and orchestration
│   └── types/               # Provider and response contracts
└── kafka/                   # Event publishing and consuming
```

## API contract

### Internal shipment API

These routes are called by trusted services and require the internal service token:

```http
POST /api/v1/internal/shipments
GET  /api/v1/internal/shipments/:shipmentId
POST /api/v1/internal/shipments/:shipmentId/advance
POST /api/v1/internal/shipments/:shipmentId/cancel
```

Shipment creation is idempotent by `orderId + shopId`. A retry after a timeout returns the existing shipment instead of generating another tracking code.

### Seller API through API Gateway

```http
POST /api/v1/seller/orders/:orderId/fulfillment/status
POST /api/v1/seller/orders/:orderId/shipment
POST /api/v1/seller/orders/:orderId/shipment/simulate-next
GET  /api/v1/seller/orders/:orderId/shipment
```

Seller scope is resolved from the authenticated user. The browser must never provide an authoritative `shopId` in query parameters or request bodies.

### Customer API through API Gateway

```http
GET /api/v1/orders/:orderId/tracking
```

Customer scope is resolved from the authenticated user. The response contains tracking information only for the customer's own order.

### Demo callback

```http
POST /api/v1/internal/webhooks/mock-ghn/:webhookToken
```

The callback validates the token and payload, records the event before returning HTTP 200, and deduplicates retries by `providerEventKey`.

## Shipment state machine

```text
READY_TO_SHIP
      │ create shipment
      ▼
PICKUP_ASSIGNED
      │ advance
      ▼
PICKED_UP
      │ advance
      ▼
IN_TRANSIT
      │ advance
      ▼
DELIVERED
```

Failure paths are explicit and append-only:

- `FAILED` records provider or simulation failure with a reason.
- `CANCELLED` is allowed only before the parcel is picked up.
- A delivered shipment is terminal and cannot be advanced again.
- Illegal transitions return a business error and do not create a history record.

Order Service owns the shop-level fulfillment state. Shipping Service owns the carrier-facing shipment state. This separation prevents one shop from changing another shop's fulfillment in a multi-shop order.

## Provider abstraction

Application services depend on a provider port rather than a GHN SDK or HTTP client:

```ts
interface ShippingProvider {
  createShipment(input: CreateShipmentInput): Promise<ProviderShipment>;
  getShipment(trackingCode: string): Promise<ProviderShipment>;
  cancelShipment(trackingCode: string): Promise<ProviderShipment>;
  advanceDemoShipment(trackingCode: string): Promise<ProviderShipment>;
}
```

`MockGhnProvider` is the default implementation. A future `GhnApiProvider` can implement the same port and use real GHN create-order, tracking and webhook operations without changing the Order Service or Web application contract.

## Persistence model

### `shipments`

- `id`, `order_id`, `shop_id`.
- `provider`, `tracking_code`, `status`.
- `current_latitude`, `current_longitude`, `current_location_label`.
- `route_points` as JSONB.
- `estimated_delivery_at`, `created_at`, `updated_at`.
- Unique constraint on `order_id + shop_id`.
- Unique constraint on `provider + tracking_code`.

### `shipment_events`

- `id`, `shipment_id`, `provider_event_key`.
- `from_status`, `to_status`, `reason`.
- `latitude`, `longitude`, `location_label`.
- `occurred_at`, `created_at`.
- Unique index on `provider_event_key` for webhook retry safety.

## Event contract

```text
shipment.status.updated
```

Example event:

```json
{
  "eventId": "shipment-status:shipment-demo-id:IN_TRANSIT",
  "eventName": "shipment.status.updated",
  "eventVersion": 1,
  "source": "shipping-service",
  "aggregateId": "shipment-demo-id",
  "data": {
    "shipmentId": "shipment-demo-id",
    "orderId": "order-demo-id",
    "shopId": "shop-demo-id",
    "trackingCode": "GHN-DEMO-8F3A21C9",
    "status": "IN_TRANSIT",
    "statusLabel": "In transit",
    "occurredAt": "2026-08-30T10:00:00.000Z",
    "currentLocation": {
      "latitude": 10.7892,
      "longitude": 106.6821,
      "label": "District 3 transit hub"
    }
  }
}
```

Consumers must process the event idempotently by `eventId`. Notification Service should send customer notifications only after the shipment event has been persisted successfully.

## Demo map

The Web application can render shipment routes with Leaflet markers and polylines. OpenStreetMap tiles are suitable for local development when attribution is preserved; the public tile server is best-effort and should not be treated as a production SLA. See the [Leaflet Quick Start](https://leafletjs.com/examples/quick-start/index.html) and [OpenStreetMap Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/).

The demo does not geocode real addresses. It uses seeded coordinates by city or a safe fallback coordinate, so the map remains deterministic and does not send customer PII to a geocoding provider.

## Security and operations

| Concern            | Policy                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------- |
| Live carrier calls | Disabled by default; only `mock-ghn` is available in demo mode.                          |
| Authentication     | External requests enter through API Gateway with JWT and permission context.             |
| Internal calls     | Require the internal service token.                                                      |
| Seller isolation   | Every shipment query checks the authenticated Seller's shop ownership.                   |
| Customer isolation | Tracking queries check order ownership in Order Service.                                 |
| Webhook safety     | Token validation, schema validation and idempotent event persistence.                    |
| Sensitive data     | Do not log full phone numbers, addresses, tokens or raw request bodies.                  |
| Database ownership | Shipping Service writes only to its own PostgreSQL database.                             |
| Reversibility      | Stop the process and reset the disposable demo database to remove the simulated journey. |

## Testing strategy

The service should be verified at four boundaries:

- Unit tests for the state machine, provider mapping and route generation.
- Repository tests for idempotent shipment creation and unique event handling.
- Integration tests with PostgreSQL and Kafka for event publication and consumption.
- API tests for permission checks, ownership isolation, invalid transitions and webhook retries.

Minimum scenarios:

1. Creating the same shipment twice returns one tracking code.
2. A Seller cannot access another shop's shipment.
3. A Customer cannot track another customer's order.
4. Invalid state transitions are rejected without changing persistence.
5. Replayed events do not duplicate history or notifications.
6. `DELIVERED` is terminal.
7. Missing address coordinates use the deterministic fallback.
8. PostgreSQL/Kafka failures return safe errors without leaking secrets.

## Roadmap

1. Scaffold the NestJS service, configuration and health endpoint.
2. Add PostgreSQL entities, migrations and repositories.
3. Implement `MockGhnProvider` and the shipment state machine.
4. Connect Order Service through internal APIs and Kafka events.
5. Add Seller Center shipment actions and demo simulation controls.
6. Add Customer tracking timeline and interactive map.
7. Add shipment status notifications and customer email templates.
8. Add an optional `GhnApiProvider` only when real carrier operations are required.

## License

Part of Bin E-Commerce. See the repository root for license information.
