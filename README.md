# E-Commerce API — Testing Practice Sandbox

A self-contained REST API built for API testing practice with Playwright, REST Assured, Postman, or any HTTP client. Covers auth flows, CRUD, pagination, caching, file uploads, BOLA/IDOR, rate limiting, fault simulation, idempotency, RFC 7807 errors, state machines, and role-based access.

> **Live API:** `https://api-gym-0w5i.onrender.com/v1`  
> **Swagger UI:** `https://api-gym-0w5i.onrender.com/docs`  
> **Free tier note:** First request after 15 min idle takes ~30 s to wake the server.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Seeded Credentials](#seeded-credentials)
- [E2E Flows](#e2e-flows)
  - [Flow 1 — Auth](#flow-1--auth)
  - [Flow 2 — Browse & Shop](#flow-2--browse--shop)
  - [Flow 3 — Checkout & Track Orders](#flow-3--checkout--track-orders)
  - [Flow 4 — Admin — Manage Catalogue](#flow-4--admin--manage-catalogue)
  - [Flow 5 — Admin — Advance Order Status](#flow-5--admin--advance-order-status)
- [Testing Hooks](#testing-hooks)
- [Security Scenarios](#security-scenarios)
- [Error Format](#error-format)
- [Response Headers Worth Asserting](#response-headers-worth-asserting)
- [Resetting State](#resetting-state)
- [Running Locally](#running-locally)

---

## Quick Start

```http
# 1. Wake the server (or reset to a clean state)
POST https://api-gym-0w5i.onrender.com/v1/seed/reset

# 2. Login and grab the accessToken
POST https://api-gym-0w5i.onrender.com/v1/auth/login
Content-Type: application/json

{ "email": "user@test.com", "password": "User123!" }

# 3. Use the token on protected routes
GET https://api-gym-0w5i.onrender.com/v1/cart
Authorization: Bearer <accessToken>
```

---

## Seeded Credentials

These are always restored by `POST /v1/seed/reset`.

| Role  | Email          | Password  | ID |
|-------|----------------|-----------|----|
| admin | admin@test.com | Admin123! | 1  |
| user  | user@test.com  | User123!  | 2  |
| user  | user2@test.com | User123!  | 3  |

**11 products** (IDs 1–11) across **4 categories** (Electronics, Clothing, Books, Home & Garden).  
Product ID 11 has `stock: 0` — useful for testing stock-error scenarios.

---

## E2E Flows

### Flow 1 — Auth

```
Register → Login → Get profile → Refresh token → Logout
```

| Step | Method | Path | Auth | Notes |
|------|--------|------|------|-------|
| 1 | POST | /auth/register | — | Body: `name`, `email`, `password`. Returns `accessToken` + `refreshToken` |
| 2 | POST | /auth/login | — | Body: `email`, `password`. Returns tokens + user |
| 3 | GET  | /auth/me | Bearer | Returns current user from token |
| 4 | POST | /auth/refresh | — | Body: `{ "refreshToken": "..." }`. Returns new `accessToken` |
| 5 | POST | /auth/logout | Bearer | Body: `{ "refreshToken": "..." }`. Revokes the refresh token |

**What to assert:**
- Register returns `201` with `Location` header pointing to the new user
- Login with wrong password → `401`
- Accessing `/auth/me` without token → `401`
- After logout, using the old `refreshToken` to refresh → `401`
- Registering with `"role": "admin"` in body → still gets `role: "user"` (mass assignment protection)

---

### Flow 2 — Browse & Shop

```
List categories → List products → Filter/search/sort → Get single product → Add to cart → Update quantity → Remove item
```

| Step | Method | Path | Auth | Notes |
|------|--------|------|------|-------|
| 1 | GET | /categories | — | Offset paginated. Cached with `Cache-Control` |
| 2 | GET | /products | — | See filtering options below |
| 3 | GET | /products/:id | — | Returns `ETag` header |
| 4 | POST | /cart/items | Bearer | Body: `{ "productId": 1, "quantity": 2 }` |
| 5 | GET  | /cart | Bearer | Returns enriched cart with product details + total |
| 6 | PUT  | /cart/items/:itemId | Bearer | Body: `{ "quantity": 5 }` — sets exact quantity |
| 7 | DELETE | /cart/items/:itemId | Bearer | Removes single line item |
| 8 | DELETE | /cart | Bearer | Clears entire cart |

**Product filtering options (GET /products):**

| Query param | Example | Behaviour |
|-------------|---------|-----------|
| `categoryId` | `?categoryId=1` | Filter to one category |
| `search` | `?search=phone` | Full-text search in name + description |
| `sortBy` | `?sortBy=price` | Sort by `id`, `name`, `price`, `stock`, `createdAt` |
| `order` | `?order=desc` | `asc` (default) or `desc` |
| `page` + `limit` | `?page=2&limit=5` | Offset pagination |
| `cursor` + `limit` | `?cursor=5&limit=5` | Cursor pagination — pass last seen product ID |

**What to assert:**
- `GET /products` returns `ETag` header — repeat request with `If-None-Match: <etag>` → `304 Not Modified`
- Adding product with `stock: 0` (ID 11) → `422 Unprocessable Entity`
- Adding more quantity than available stock → `422`
- Cart total matches sum of `price × quantity` for all items

---

### Flow 3 — Checkout & Track Orders

```
Add items to cart → Checkout → View order → Cancel order  
                            ↓  
                   Retry checkout with same Idempotency-Key → same 201, no duplicate
```

| Step | Method | Path | Auth | Notes |
|------|--------|------|------|-------|
| 1 | POST | /cart/items | Bearer | Add at least one item |
| 2 | POST | /orders | Bearer | Checkout. Optionally include `Idempotency-Key` header |
| 3 | GET  | /orders | Bearer | List own orders. Filter by `?status=pending` |
| 4 | GET  | /orders/:id | Bearer | View single order details |
| 5 | POST | /orders/:id/cancel | Bearer | Cancel while status is `pending` or `confirmed` |

**What to assert:**
- Checkout returns `201` with `Location` header
- Checkout with empty cart → `400`
- After checkout, product stock is decremented
- After cancel, product stock is restored
- Cancelling a `shipped` order → `409 Conflict`
- Sending same `Idempotency-Key` twice → second request returns the original `201` response, no new order created
- User A trying to `GET /orders/:id` for User B's order → `403 Forbidden` (BOLA/IDOR)

---

### Flow 4 — Admin — Manage Catalogue

```
Login as admin → Create category → Create product → Upload image → Update product → Delete product
```

| Step | Method | Path | Auth | Notes |
|------|--------|------|------|-------|
| 1 | POST | /auth/login | — | Use admin credentials |
| 2 | POST | /categories | Bearer (admin) | Body: `{ "name": "...", "description": "..." }` |
| 3 | POST | /products | Bearer (admin) | Body requires `name`, `price`, `stock`, `categoryId` |
| 4 | POST | /products/:id/image | Bearer (admin) | `multipart/form-data`, field `image`, max 5 MB, JPEG/PNG/WebP |
| 5 | GET  | /products/:id/image | — | Serves raw binary image |
| 6 | PATCH | /products/:id | Bearer (admin) | Partial update — only send fields to change |
| 7 | PUT  | /products/:id | Bearer (admin) | Full replace — all fields required |
| 8 | DELETE | /products/:id | Bearer (admin) | Returns `204` |

**What to assert:**
- All create/update responses return `Location` header pointing to the resource
- Non-admin token on any admin route → `403 Forbidden`
- Creating product with non-existent `categoryId` → `404 Not Found`
- Uploading image > 5 MB → `413 Content Too Large`
- Uploading non-image file → `422 Unprocessable Entity`
- PATCH with unknown fields → fields silently stripped (not `422`)

---

### Flow 5 — Admin — Advance Order Status

```
Login as admin → List all orders → Move order through state machine
```

**State machine:**

```
pending → confirmed → shipped → delivered
   ↓            ↓
cancelled    cancelled
```

| Step | Method | Path | Auth | Notes |
|------|--------|------|------|-------|
| 1 | GET  | /orders | Bearer (admin) | Admin sees all users' orders |
| 2 | PATCH | /orders/:id/status | Bearer (admin) | Body: `{ "status": "confirmed" }` |
| 3 | PATCH | /orders/:id/status | Bearer (admin) | Body: `{ "status": "shipped" }` |
| 4 | PATCH | /orders/:id/status | Bearer (admin) | Body: `{ "status": "delivered" }` |

**What to assert:**
- `delivered` → any status → `422 Unprocessable Entity` (terminal state)
- `cancelled` → any status → `422` (terminal state)
- Skipping states (e.g. `pending → shipped`) → `422`

---

## Testing Hooks

These query params and headers are available on specific endpoints for testing edge cases.

| Hook | Endpoints | How |
|------|-----------|-----|
| `?_delay=N` | GET /products, /products/:id, /orders/:id | Delays response by N ms (max 10 000). Test timeouts. |
| `?_fail=N` | GET /products, /products/:id, /orders/:id | Forces that HTTP status code (e.g. `?_fail=503`). Test error handling. |
| `Idempotency-Key: <uuid>` | POST /orders | Send the same UUID twice — second call returns the original response. Test safe retries. |
| `If-None-Match: <etag>` | GET /products, GET /products/:id | Returns `304 Not Modified` when data is unchanged. Test caching. |

---

## Security Scenarios

| Scenario | Expected |
|----------|----------|
| No `Authorization` header on protected route | `401` |
| Expired access token | `401` with `"expired"` in `detail` |
| `alg:none` JWT attack | `401` (server enforces `HS256`) |
| Regular user accessing admin route | `403` |
| User A reading User B's order | `403` (BOLA/IDOR) |
| Register with `"role": "admin"` in body | Role is forced to `"user"` |
| PATCH /users/me with `"role"` in body | Field silently stripped |
| 5 failed logins from same IP | 6th attempt → `429 Too Many Requests` |
| Login after soft-delete | `401` |
| SQL injection in search param | `200` — treated as literal string, no SQL engine |

---

## Error Format

All errors use [RFC 7807](https://datatracker.ietf.org/doc/html/rfc7807) with `Content-Type: application/problem+json`:

```json
{
  "type": "https://api-gym-0w5i.onrender.com/errors/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "Product with id 99 does not exist",
  "instance": "/v1/products/99"
}
```

Validation errors (`422`) also include an `errors[]` array with per-field detail.

---

## Response Headers Worth Asserting

| Header | Present on |
|--------|-----------|
| `X-Request-Id` | Every response |
| `X-RateLimit-Limit` | POST /auth/login |
| `X-RateLimit-Remaining` | POST /auth/login |
| `Retry-After` | `429` responses |
| `ETag` | GET /products, GET /products/:id |
| `Cache-Control` | GET /products, GET /categories, GET /products/:id/image |
| `Location` | All `201` responses |

---

## Resetting State

Call this before each test suite (or in `beforeEach`) to restore a clean, known state:

```http
POST /v1/seed/reset
```

Returns the seeded credentials and counts as confirmation.

For a bare-minimum state (users only, no products or categories):

```http
POST /v1/seed/minimal
```

Useful for testing empty catalogue edge cases.

---

## Running Locally

```bash
git clone https://github.com/<your-username>/api-gym.git
cd api-gym
npm install
cp .env.example .env
npm start
```

- API: `http://localhost:3000/v1`
- Swagger UI: `http://localhost:3000/docs`
- Health check: `http://localhost:3000/health`

For watch mode: `npm run dev`
