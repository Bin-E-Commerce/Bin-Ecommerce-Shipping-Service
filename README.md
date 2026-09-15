<div align="center">
  <img src="https://raw.githubusercontent.com/Bin-E-Commerce/Bin-E-Commerce-UI-Web/main/public/images/logo/logo_background_white.png" alt="Bin E-Commerce" width="220" />

  # Shipping Service

  Turn an order into a trackable delivery, keep carrier complexity behind one stable contract, and make every status understandable.

  <p>
    <img src="https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white" alt="NestJS 11" />
    <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.7" />
    <img src="https://img.shields.io/badge/PostgreSQL-336791?logo=postgresql&logoColor=white" alt="PostgreSQL" />
    <img src="https://img.shields.io/badge/TypeORM-FE0803?logo=typeorm&logoColor=white" alt="TypeORM" />
    <img src="https://img.shields.io/badge/Kafka-231F20?logo=apachekafka&logoColor=white" alt="Kafka" />
    <img src="https://img.shields.io/badge/GHN-provider-16A34A" alt="GHN provider" />
    <img src="https://img.shields.io/badge/Scheduler-FFB000" alt="Nest scheduler" />
  </p>

  [Portfolio](https://daongocanh.site)
</div>

---

## Table of contents

1. [Problem](#1-problem)
2. [Service at a glance](#2-service-at-a-glance)
3. [Responsibility and boundaries](#3-responsibility-and-boundaries)
4. [Trust surface](#4-trust-surface)
5. [See it work](#5-see-it-work)
6. [Installation](#6-installation)
7. [Shipment lifecycle](#7-shipment-lifecycle)
8. [Canonical status model](#8-canonical-status-model)
9. [Provider boundary](#9-provider-boundary)
10. [Quote and shipment creation](#10-quote-and-shipment-creation)
11. [Tracking and synchronization](#11-tracking-and-synchronization)
12. [Returns](#12-returns)
13. [Webhook processing](#13-webhook-processing)
14. [Events and integrations](#14-events-and-integrations)
15. [Persistence model](#15-persistence-model)
16. [API reference](#16-api-reference)
17. [Project structure](#17-project-structure)
18. [Configuration](#18-configuration)
19. [Local development](#19-local-development)
20. [Testing](#20-testing)
21. [Security and data integrity](#21-security-and-data-integrity)
22. [Operations and reliability](#22-operations-and-reliability)
23. [FAQ](#23-faq)
24. [Ownership](#24-ownership)

---

## 1. Problem

A carrier has its own status codes, address identifiers, API payloads, retry behavior, and webhook format. The marketplace needs a stable delivery contract that Order Service, Seller Center, Customer Tracking, Return flows, and Notification Service can use without understanding carrier-specific details.

Shipping Service is the fulfillment boundary for that problem. It resolves seller pickup information, calculates shipping quotes, creates and cancels carrier orders, maps provider status to a canonical lifecycle, stores an append-only shipment history, exposes tracking, and publishes stable shipment events.

The source of truth for an order remains Order Service. The source of truth for shop ownership and pickup configuration remains Seller Service. Shipping Service owns the shipment aggregate and the translation between the platform lifecycle and GHN.

---

## 2. Service at a glance

| Property | Value |
| --- | --- |
| Runtime | Node.js with NestJS 11 |
| Language | TypeScript |
| Default HTTP port | 3012 |
| HTTP prefix | /api |
| URI version | /v1 |
| Database | PostgreSQL |
| ORM | TypeORM |
| Provider | GHN adapter and GHN test provider |
| Event transport | Kafka |
| Scheduled work | Nest Schedule |
| HTTP security | Helmet |
| Health endpoint | GET /api/v1/health |
| API documentation | GET /docs outside production |
| Schema policy | Migrations only; synchronize is disabled |

### What this service provides

- shipping location lookup through GHN master data;
- server-side shipping quote;
- forward shipment creation for sellers;
- return shipment creation after an approved return;
- carrier tracking synchronization;
- seller shipment lookup, refresh, cancellation, and label download;
- customer tracking by order;
- GHN webhook processing;
- demo status advancement for local testing;
- canonical shipment and return status;
- shipment event history;
- Kafka shipment status events;
- internal APIs for Order Service and workers.

### What this service does not own

- order totals, payment, or order status;
- seller ownership or pickup-address ownership;
- customer authentication;
- carrier credentials outside the provider adapter;
- notification rendering;
- product inventory;
- return approval decisions.

---

## 3. Responsibility and boundaries

### Shipping Service owns

| Area | Responsibility |
| --- | --- |
| Shipment aggregate | Shipment identity, tracking references, status, location, and estimates |
| Provider mapping | GHN request/response mapping and status translation |
| Shipment history | Append-only canonical transition records |
| Quote | Server-side shipping price and service information |
| Tracking | Customer and seller tracking responses |
| Synchronization | Provider refresh and internal reconciliation |
| Webhooks | Provider callback validation and state update |
| Returns | Reverse shipment creation and tracking |
| Integration events | shipment.status.updated publication |
| Test provider | Deterministic demo lifecycle without production carrier calls |

### Other services own

| Concern | Owner | Shipping interaction |
| --- | --- | --- |
| Order and return approval | Order Service | Provides order context and return authorization |
| Seller shop and pickup address | Seller Service | Provides default pickup and readiness |
| Product package data | Product Service | Supplies weight and dimensions through checkout/order flow |
| User authentication | Auth Service / Gateway | Supplies trusted customer and seller identity |
| Notifications | Notification Service | Consumes shipment status events |
| Carrier credentials | Deployment secrets | Injected into Shipping Service only |
| Customer UI | Web application | Renders tracking and delivery status |

Cross-service IDs are logical references. Shipping Service does not create database foreign keys into Order or Seller databases.

---

## 4. Trust surface

Shipping operations involve money, addresses, customer identity, seller ownership, and carrier credentials.

- seller identity is taken from trusted Gateway headers;
- seller shipment routes resolve the shop from the authenticated seller context;
- customer tracking does not accept an arbitrary owner ID from the query or body;
- internal routes require the shared internal service token;
- GHN credentials are server-side only;
- webhook payloads are processed through the shipping state machine;
- provider statuses are never treated as canonical order statuses;
- cancellation is allowed only when the carrier and local lifecycle permit it;
- status transitions are checked against current state;
- provider event keys are unique to make webhook and polling retries idempotent;
- pickup addresses are snapshotted on the shipment so later seller edits do not rewrite delivery history;
- DTO validation rejects unknown fields and malformed UUIDs;
- health and docs routes do not expose provider secrets.

<details>
<summary><b>Caller capabilities and data exposure</b></summary>

| Caller | Allowed operation |
| --- | --- |
| Customer through Gateway | Read tracking for their order |
| Authenticated seller | Create, read, refresh, cancel, and print their shipment label |
| Authenticated seller | Create and inspect an approved return shipment |
| Order Service | Quote, read, synchronize, and cancel internal shipments |
| Shipping worker | Refresh provider state through an internal route |
| GHN | Send webhook callbacks through the protected callback boundary |
| Notification Service | Consume shipment status events |

Customer responses contain tracking information needed for the order page. Seller responses contain operational shipment data for the current shop. Internal responses are limited to the fields required by the calling workflow.

</details>

---

## 5. See it work

### Start the service

~~~powershell
cd services/shipping-service
Copy-Item .env.example .env
npm install
npm run dev
~~~

### Check health

~~~powershell
curl http://localhost:3012/api/v1/health
~~~

Expected shape:

~~~json
{
  "status": "ok",
  "service": "shipping-service",
  "port": 3012
}
~~~

### Enable the local demo provider

~~~text
SHIPPING_DEMO_MODE=true
~~~

Demo mode allows controlled shipment transitions without requiring live GHN credentials. It is intended for local and test workflows only.

### Customer tracking

The customer request is normally routed through API Gateway:

~~~powershell
curl "http://localhost:3001/api/v1/orders/{orderId}/tracking" -H "Authorization: Bearer <access-token>"
~~~

Direct local service testing uses a trusted user header:

~~~powershell
curl "http://localhost:3012/api/v1/orders/{orderId}/tracking" -H "x-user-id: customer-123"
~~~

### Seller shipment actions

~~~powershell
curl -X POST "http://localhost:3012/api/v1/seller/orders/{orderId}/shipment" -H "x-user-id: seller-123" -H "x-user-email: seller@example.com"
curl "http://localhost:3012/api/v1/seller/orders/{orderId}/shipment" -H "x-user-id: seller-123"
curl -X POST "http://localhost:3012/api/v1/seller/orders/{orderId}/shipment/demo/advance" -H "x-user-id: seller-123"
~~~

After a demo transition, read customer tracking again and inspect the emitted shipment.status.updated event.

---

## 6. Installation

### Prerequisites

- Node.js version supported by the monorepo;
- npm or the repository package manager;
- PostgreSQL;
- Kafka for shipment status events;
- Order Service for order and return context;
- Seller Service for shop pickup configuration;
- GHN test credentials when not using demo mode.

### Install dependencies

From the repository root:

~~~bash
npm install
~~~

### Configure local environment

~~~powershell
Copy-Item .env.example .env
~~~

The local template uses:

- PostgreSQL database bin_shipping;
- Shipping Service on port 3012;
- Kafka at localhost:29092;
- Order Service on port 3011;
- Seller Service on port 3007;
- GHN test gateway;
- demo mode enabled by default.

> [!IMPORTANT]
> Shipping Service writes shipment and shipment-event data to PostgreSQL, calls Order and Seller services, calls GHN when provider mode is enabled, publishes Kafka events, and can receive carrier webhooks. GHN tokens, shop IDs, client IDs, and internal service tokens must come from deployment secrets. Stop the process or container to disable it; remove only the dedicated local shipping database to clear test data.

### Database migrations

The service runs TypeORM migrations on startup and keeps synchronize disabled. Review migrations before deployment, especially those that change provider mapping, GHN address codes, and return shipment support.

### Production build

~~~bash
npm run type-check
npm run type-check:test
npm run lint
npm test -- --runInBand
npm run build
npm run start
~~~

---

## 7. Shipment lifecycle

### Forward shipment

~~~text
READY_TO_SHIP
  -> PICKUP_ASSIGNED
  -> PICKED_UP
  -> IN_TRANSIT
  -> DELIVERED

Failure path:
  -> FAILED

Cancellation path:
  -> CANCELLED

Reverse path:
  -> RETURNING
  -> RETURNED
~~~

The current canonical statuses are:

- READY_TO_SHIP;
- PICKUP_ASSIGNED;
- PICKED_UP;
- IN_TRANSIT;
- DELIVERED;
- FAILED;
- CANCELLED;
- RETURNING;
- RETURNED.

### Creation flow

1. Seller or Order Service requests shipment creation.
2. Shipping Service obtains order and seller context.
3. The default pickup address is resolved from Seller Service.
4. Package dimensions and weight are taken from the order/product contract.
5. The provider adapter creates or simulates the carrier order.
6. Shipment and initial event are saved.
7. A shipment status event is published after the local state is committed.

### Transition flow

A transition records:

- previous canonical status;
- new canonical status;
- provider status code and text;
- event source;
- location;
- reason;
- occurred time;
- provider event key.

A transition is not applied by writing directly to the database from a controller. Webhooks, refreshes, demo actions, and workers all pass through the same application state rules.

---

## 8. Canonical status model

Provider status codes are mapped to a stable platform status. This protects consumers from GHN-specific text and makes a future provider adapter possible.

| Canonical status | Meaning |
| --- | --- |
| READY_TO_SHIP | Shipment exists and is waiting for pickup |
| PICKUP_ASSIGNED | Carrier pickup has been assigned |
| PICKED_UP | Carrier has collected the package |
| IN_TRANSIT | Package is moving through the carrier network |
| DELIVERED | Customer delivery completed |
| FAILED | Delivery or carrier operation failed |
| CANCELLED | Shipment was cancelled |
| RETURNING | Package is moving back to the seller |
| RETURNED | Return shipment reached the seller |

### Transition rules

- only valid lifecycle transitions are accepted;
- cancellation is blocked after the carrier has collected the shipment;
- repeated provider events do not create duplicate transitions;
- older or duplicate webhook events do not move the shipment backward;
- local state is updated before integration consumers are notified;
- provider text is retained for diagnosis but not used as the platform contract.

---

## 9. Provider boundary

The provider layer separates carrier concerns from shipment orchestration.

### GHN adapter responsibilities

- authenticate with GHN;
- submit shipping quotes;
- create forward and return orders;
- cancel eligible carrier orders;
- request tracking information;
- request shipping labels;
- load provinces, districts, and wards;
- map GHN response fields into application types;
- map GHN status codes to canonical statuses;
- enforce timeout and request boundaries.

### Test provider responsibilities

The GHN test provider supports local workflows without real carrier side effects. It returns deterministic references, status changes, labels, and locations suitable for development and automated tests.

Demo mode must not be enabled in production. Test transitions are useful for UI and integration acceptance, but they do not represent carrier SLA or real-world webhook timing.

### Provider replacement

A new carrier should implement the provider contract and status mapper without changing:

- Order Service contracts;
- customer tracking response semantics;
- seller shipment route semantics;
- shipment event consumers;
- Notification Service event handling.

---

## 10. Quote and shipment creation

### Quote

Order Service calls the internal quote route before creating or confirming an order. Shipping Service resolves the pickup address from Seller Service and combines it with delivery/package data.

~~~text
Order checkout
  -> internal shipping quote
  -> current delivery and package validation
  -> provider price/service response
  -> order displays or stores the quote
~~~

The quote is not a shipment and must not create a tracking code or change shipment state.

### Forward creation

Forward creation uses:

- order ID and order context;
- seller shop context;
- customer destination;
- package weight and dimensions;
- selected carrier/service information;
- pickup address snapshot.

The shipment stores the pickup snapshot because a later shop-address edit must not change where an existing package was originally collected.

### Cancellation

Seller or Order Service can request cancellation only while the carrier has not collected the package and the canonical state allows it. The provider is cancelled before the local canonical state is moved to CANCELLED.

If the provider rejects cancellation, the local shipment should not claim cancellation succeeded.

### Label

Seller label download returns provider-generated binary content with the correct content type and file extension. Label retrieval is scoped to the seller's shipment access and does not expose another shop's label.

---

## 11. Tracking and synchronization

### Customer tracking

Customer tracking is scoped by order ID and authenticated customer identity. The service returns the shipment view needed to display:

- tracking code;
- canonical status;
- current location;
- route points;
- estimated delivery time;
- event history;
- shipment kind;
- relevant order and return references.

### Seller tracking

Seller tracking is scoped to the shop resolved from the seller context. Seller operations include:

- read shipment;
- refresh provider state;
- cancel eligible shipment;
- download label;
- create and inspect return shipment;
- advance demo state in local mode.

### Provider refresh

Refresh reads current provider state and passes it to the same transition logic used by webhooks. A refresh does not arbitrarily push a shipment forward; it maps provider truth into the canonical state machine.

### Reconciliation

A scheduled worker or Order Service can call internal synchronization for shipments whose webhook is late or missing. Reconciliation should be bounded and idempotent, with provider reference and last sync timestamps available for operations.

---

## 12. Returns

Return approval belongs to Order Service. Once a return is authorized, Shipping Service can create the reverse shipment for the seller.

### Return flow

~~~text
Order approves return
  -> seller creates return shipment
  -> provider return order
  -> RETURNING
  -> seller receives package
  -> RETURNED
~~~

Return shipments are stored as separate shipment records with:

- shipmentKind = RETURN;
- returnRequestId;
- original order reference;
- seller and customer references;
- provider tracking reference;
- independent event history.

Customer demo advancement is scoped by return ownership. Seller creation is scoped by the authenticated seller shop.

---

## 13. Webhook processing

GHN sends callbacks to:

~~~text
POST /api/internal/webhooks/ghn
~~~

The webhook controller acknowledges with HTTP 200 after handing the payload to Shipping Service.

### Processing steps

1. receive the provider payload;
2. identify the shipment by provider reference;
3. validate the mapped status and event data;
4. build a stable provider event key;
5. ignore an already-processed key;
6. validate the current-to-next status transition;
7. persist the shipment event and update the aggregate;
8. publish shipment.status.updated;
9. return the provider acknowledgment.

### Webhook guarantees

- provider event keys are unique;
- duplicate callbacks do not duplicate history;
- event source is stored as WEBHOOK;
- provider code and text remain available for support;
- invalid payloads do not silently move shipment state;
- callbacks do not accept a client-controlled owner identity;
- webhook exposure must be restricted by provider network, signature policy, gateway rule, or an equivalent deployment boundary.

---

## 14. Events and integrations

### Published event

Shipping Service publishes:

~~~text
shipment.status.updated
~~~

The event includes:

- event ID from the provider event key;
- event name and version;
- source service;
- shipment aggregate ID;
- occurrence time;
- shipment and return references;
- order number;
- shop, seller, and customer IDs;
- tracking code;
- canonical status and display label;
- provider status code;
- current latitude, longitude, and location label.

Notification Service uses this contract for customer and seller notifications. Order Service can use it to update its delivery projection.

### Kafka behavior

- events are published with the shipment aggregate key;
- all updates for one shipment remain ordered within a Kafka partition;
- publication happens after local persistence;
- producer retry handles short network failures;
- a broker outage must not corrupt committed shipment state;
- monitor publish failures and consumer lag.

### Service integrations

| Service | Purpose |
| --- | --- |
| Order Service | Order context, return authorization, internal orchestration |
| Seller Service | Pickup address, shop ownership, shipping readiness |
| Product Service | Package and product data upstream |
| Notification Service | Customer and seller delivery notifications |
| Kafka | Shipment status integration events |
| GHN | Quote, create, cancel, tracking, label, locations, webhook |

---

## 15. Persistence model

### shipments

The shipment aggregate stores:

- order ID and order number;
- shop, seller, and customer IDs;
- forward or return kind;
- return request ID;
- provider and provider references;
- provider tracking ID;
- provider status code and text;
- last provider sync time;
- pickup address snapshot;
- tracking code;
- canonical status;
- current coordinates and location label;
- route points;
- estimated delivery time;
- optimistic version;
- created and updated timestamps.

Unique constraints protect:

- one shipment per order/shop/kind;
- one provider/tracking combination.

### shipment_events

The append-only event history stores:

- shipment ID;
- unique provider event key;
- from and to canonical statuses;
- reason;
- coordinates and location;
- occurrence time;
- provider status code;
- event source;
- creation time.

Indexes support:

- event idempotency;
- shipment history ordered by occurrence;
- operational lookup by shipment.

### Pickup snapshot

The pickup snapshot is copied into the shipment at creation time. It is not a live relation to Seller Service, so a seller changing their default address later does not alter an existing delivery's historical origin.

### Schema evolution

Migrations cover:

- initial shipment tables;
- provider migration history;
- GHN test configuration;
- return shipment support.

Do not use runtime schema synchronization in production.

---

## 16. API reference

All versioned routes use /api/v1.

### Customer

| Method | Route | Purpose |
| --- | --- | --- |
| GET | /orders/:orderId/tracking | Read tracking for the authenticated customer |
| POST | /orders/returns/:returnId/shipment/demo/advance | Advance a return shipment in demo mode |

### Seller

| Method | Route | Purpose |
| --- | --- | --- |
| POST | /seller/orders/:orderId/shipment | Create a forward shipment |
| GET | /seller/orders/:orderId/shipment | Read the current shop's shipment |
| POST | /seller/orders/:orderId/shipment/refresh | Refresh provider tracking |
| POST | /seller/orders/:orderId/shipment/cancel | Cancel an eligible shipment |
| GET | /seller/orders/:orderId/shipment/label | Download the carrier label |
| POST | /seller/orders/:returnId/shipment | Create a return shipment |
| POST | /seller/orders/:orderId/shipment/demo/advance | Advance a forward shipment in demo mode |

Seller routes derive shop scope from trusted headers.

### Internal

| Method | Route | Purpose |
| --- | --- | --- |
| GET | /internal/shipments/:shipmentId | Read an internal shipment |
| POST | /internal/shipments/quotes | Calculate a shipping quote |
| POST | /internal/shipments/:shipmentId/sync | Synchronize provider state |
| POST | /internal/shipments/:shipmentId/cancel | Cancel through the provider |

Internal routes require x-internal-service-token.

### Locations

| Method | Route | Purpose |
| --- | --- | --- |
| GET | /shipping/locations/provinces | List GHN provinces |
| GET | /shipping/locations/districts?provinceId=... | List districts for a province |
| GET | /shipping/locations/wards?districtId=... | List wards for a district |

### Webhook and health

| Method | Route | Purpose |
| --- | --- | --- |
| POST | /internal/webhooks/ghn | Receive GHN status callback |
| GET | /health | Report process health |
| GET | /docs | Swagger UI outside production |

### Response and error behavior

- malformed UUIDs return a validation error;
- missing or invalid internal tokens return unauthorized;
- an invalid status transition returns a business error;
- provider failure does not claim a successful shipment mutation;
- label responses use binary content headers;
- webhook acknowledgment follows the provider contract.

---

## 17. Project structure

~~~text
services/shipping-service/
+-- src/
|   +-- main.ts
|   +-- app.module.ts
|   +-- database/
|   |   +-- entities/
|   |   +-- enums/
|   |   +-- migrations/
|   +-- kafka/
|   |   +-- kafka.module.ts
|   |   +-- kafka-producer.service.ts
|   |   +-- shipment-events.publisher.ts
|   +-- modules/
|       +-- health/
|       +-- shipping/
|           +-- application/
|           |   +-- clients/
|           |   +-- providers/
|           |   +-- services/
|           |   +-- types/
|           +-- infrastructure/
|           |   +-- repositories/
|           +-- presentation/
|               +-- controllers/
|               +-- dto/
+-- .env.example
+-- package.json
+-- tsconfig.json
+-- README.md
~~~

### Organization rules

- controllers define customer, seller, internal, location, webhook, and health boundaries;
- ShippingService owns orchestration and transition rules;
- provider adapters own GHN-specific behavior;
- clients isolate Order and Seller service calls;
- repository code owns PostgreSQL persistence;
- Kafka publisher owns integration event mapping;
- entities and migrations own database shape;
- DTOs validate transport input before business logic.

---

## 18. Configuration

Use [.env.example](./.env.example) as the canonical local template.

| Variable | Required | Purpose |
| --- | --- | --- |
| NODE_ENV | No | Runtime environment |
| PORT | No | HTTP port, default 3012 |
| POSTGRES_HOST | Yes | PostgreSQL host |
| POSTGRES_PORT | No | PostgreSQL port |
| POSTGRES_USER | Yes | PostgreSQL user |
| POSTGRES_PASSWORD | Yes | PostgreSQL password |
| POSTGRES_DB | Yes | Shipping database |
| KAFKA_BROKERS | Yes for events | Kafka broker list |
| KAFKA_CLIENT_ID | No | Kafka client identifier |
| KAFKA_GROUP_ID | No | Consumer group when workers use it |
| INTERNAL_SERVICE_TOKEN | Yes for internal routes | Shared service credential |
| ORDER_SERVICE_URL | Yes | Order Service base URL |
| SELLER_SERVICE_URL | Yes | Seller Service base URL |
| GHN_BASE_URL | Yes in provider mode | GHN API base URL |
| GHN_TOKEN | Yes in provider mode | GHN token |
| GHN_SHOP_ID | Yes in provider mode | GHN shop identifier |
| GHN_CLIENT_ID | Provider dependent | GHN client identifier |
| GHN_SERVICE_TYPE_ID | No | Default GHN service type |
| GHN_REQUEST_TIMEOUT_MS | No | Provider request timeout |
| SHIPPING_DEMO_MODE | No | Enable local demo provider |
| MAP_DEFAULT_LATITUDE | No | Default demo map latitude |
| MAP_DEFAULT_LONGITUDE | No | Default demo map longitude |

### Configuration rules

- use .env.local for developer-only overrides;
- inject GHN and internal credentials through deployment secrets;
- never log provider tokens or complete webhook payloads;
- keep demo mode false in production;
- keep provider URLs environment-specific;
- use TLS for PostgreSQL, Kafka, and HTTP integrations in production;
- use least-privilege database credentials.

---

## 19. Local development

### Commands

~~~bash
npm run dev
npm run type-check
npm run type-check:test
npm run lint
npm test
npm run build
npm run start
~~~

### Recommended sequence

1. Start PostgreSQL and create bin_shipping.
2. Start Kafka if testing shipment events.
3. Start Order and Seller services for real context resolution.
4. Copy .env.example to .env.
5. Leave SHIPPING_DEMO_MODE=true for UI and local transition tests.
6. Start Shipping Service.
7. Verify GET /api/v1/health.
8. Open GET /docs in development.
9. Create or locate an order with a valid seller pickup address.
10. Request a seller shipment.
11. Advance the demo shipment or refresh the provider state.
12. Read customer tracking.
13. Test label download.
14. Test return shipment creation after return approval.
15. Verify Kafka shipment.status.updated payloads.
16. Test internal quote and cancellation with the shared token.

### Swagger

When NODE_ENV is not production:

~~~text
http://localhost:3012/docs
~~~

The OpenAPI document describes HTTP routes. Kafka event payloads are defined by the publisher and shared event contract.

---

## 20. Testing

### Provider tests

Cover:

- GHN request and response mapping;
- status-code mapping;
- timeout behavior;
- invalid provider response;
- quote response normalization;
- label content type and extension;
- test provider deterministic transitions;
- provider cancellation rules.

### State-machine tests

Cover:

- every valid canonical transition;
- invalid backward transition;
- duplicate provider event;
- cancellation before and after pickup;
- delivery failure;
- return transitions;
- event source and reason persistence;
- version and concurrency behavior.

### Service tests

Cover:

- seller ownership;
- customer order ownership;
- pickup-address lookup;
- quote without shipment mutation;
- forward shipment creation;
- return shipment creation;
- provider refresh;
- internal cancellation;
- label download;
- demo-mode guard;
- missing Order or Seller response;
- provider timeout and failure.

### Webhook tests

Cover:

- provider shipment lookup;
- unique provider event key;
- duplicate callback;
- invalid status;
- stale callback;
- location mapping;
- append-only history;
- HTTP acknowledgment.

### Integration and E2E

Use PostgreSQL, Kafka, provider stubs, and Order/Seller test doubles to verify:

- migration startup;
- quote and creation contract;
- transaction plus event publication;
- webhook and polling convergence;
- customer and seller authorization;
- return shipment lifecycle;
- internal token enforcement;
- Kafka notification integration.

### Commands

~~~bash
npm run type-check
npm run type-check:test
npm run lint
npm test -- --runInBand
npm run build
~~~

---

## 21. Security and data integrity

- place the public service behind API Gateway;
- derive customer and seller identity from trusted context;
- never accept owner IDs from browser body or query input;
- require internal service tokens for Order and worker routes;
- restrict webhook exposure to the provider and trusted infrastructure;
- store GHN tokens and shop IDs only in secrets;
- use Helmet security headers;
- validate DTOs and UUIDs;
- use transactions for shipment aggregate and event-history updates;
- use unique provider event keys for webhook idempotency;
- snapshot pickup data at shipment creation;
- use optimistic versioning for concurrent shipment updates;
- do not allow cancellation after pickup;
- do not overwrite canonical state with raw provider text;
- do not log addresses, tokens, or full provider payloads unnecessarily;
- mask customer and seller data in operational exports;
- use TLS and least-privilege credentials in production;
- keep demo provider disabled in production;
- apply migrations through controlled deployment.

---

## 22. Operations and reliability

### Health

GET /api/v1/health is a lightweight process check. It reports:

- service name;
- status;
- port.

Dependency health should be monitored separately through PostgreSQL, Kafka, GHN, Order, and Seller telemetry.

### Metrics to monitor

- quote latency and failure rate;
- shipment creation success/failure;
- provider timeout and rate-limit errors;
- cancellation rejection rate;
- webhook volume and duplicate rate;
- shipment transition latency;
- shipments stuck in each status;
- last provider sync age;
- Kafka publish failures and consumer lag;
- internal token rejection;
- pickup-address lookup failure;
- label download errors;
- return shipment creation and delivery times;
- database connection pool and transaction latency.

### Reconciliation

Use scheduled refresh or internal sync for:

- shipments with stale lastProviderSyncedAt;
- shipments missing a webhook;
- provider/local status mismatches;
- events that were committed but not published successfully.

Reconciliation must be idempotent and must use the same transition logic as webhook processing.

### Scaling

Multiple instances can share PostgreSQL and Kafka when:

- migrations are applied before serving traffic;
- all instances run compatible provider and event contracts;
- shipment updates use transactions and optimistic versions;
- scheduled workers coordinate leases or avoid duplicate work;
- Kafka publication is monitored for duplicate and missing events;
- provider rate limits are respected globally.

### Incident response

1. Check health and database connectivity.
2. Inspect provider timeout and error metrics.
3. Compare provider status with the local shipment event history.
4. Check Kafka publish status and Notification/Order consumer lag.
5. Disable demo mode or provider traffic if the deployment is misconfigured.
6. Run a controlled internal sync for affected shipments.
7. Avoid direct database status edits; use the transition service.
8. Reconcile webhook and poll results before changing operational policy.

---

## 23. FAQ

### Why does Shipping Service have canonical statuses?

GHN status codes and text are provider-specific. Canonical statuses keep Order, Notification, seller UI, and customer tracking stable.

### Does Shipping Service own the order?

No. Order Service owns the order and return decision. Shipping Service owns the shipment and fulfillment history.

### Why is pickup address stored as a snapshot?

A seller may change their default address after a shipment is created. Historical delivery origin must remain unchanged.

### Can I test without GHN credentials?

Yes. Set SHIPPING_DEMO_MODE=true and use demo advancement endpoints. Demo mode is not a production carrier simulation.

### Why does a provider webhook not directly update Order Service?

Shipping Service first validates and persists the canonical transition, then publishes shipment.status.updated. Consumers use the stable event contract.

### Why can shipment cancellation fail even when the seller requests it?

The carrier may already have collected the package, or the current canonical status may not allow cancellation. The service must not claim cancellation when the provider rejected it.

### What happens if GHN sends the same webhook twice?

The provider event key is unique. The duplicate callback is ignored after the first successful transition.

### What happens if a webhook is delayed?

A refresh or reconciliation worker can query the provider and pass the result through the same state machine.

### Where are GHN credentials configured?

Only in deployment environment secrets. They are not accepted from browser payloads and are not returned by any API.

### How are return shipments different?

They are separate shipment records with shipmentKind RETURN and a returnRequestId, while sharing the canonical event and provider boundary.

---

## 24. Ownership

### Engineering

**Đào Ngọc Anh**

**Software Engineer**

[View portfolio](https://daongocanh.site)

Software Engineer responsible for the architecture, implementation, integration, and maintenance of this service.

### Architecture and API design

**Đào Ngọc Anh**

Designed the shipment aggregate, canonical delivery state machine, GHN provider adapter, quote and tracking contracts, webhook idempotency, return shipment flow, and Kafka integration for the Bin E-Commerce ecosystem.
