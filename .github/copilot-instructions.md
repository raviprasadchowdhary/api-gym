# Repository: api-testing-sandbox

## Purpose
A self-contained REST API built purely for API testing practice — Playwright, REST Assured, Postman, etc.
Zero external database. All data lives in a Node.js in-memory object (`src/db/store.js`).
Deployed for free on Render.com. Auto-resets to seed data on each deploy (cold start).

---

## Tech Stack
| Layer | Choice |
|---|---|
| Runtime | Node.js ≥18 |
| Framework | Express 4 |
| Auth | JWT (HS256) via `jsonwebtoken`, passwords via `bcryptjs` |
| Validation | Joi (strips unknown fields — mass assignment protection) |
| File upload | multer 2.x (memory storage, 5MB limit, JPEG/PNG/WebP) |
| Docs | Swagger UI at `/docs` (swagger.yaml, OpenAPI 3.0) |
| Logging | morgan (combined format) |

---

## Project Structure
```
src/
├── app.js                   ← Express app, middleware chain, route mounting, boot
├── db/
│   ├── store.js             ← Single shared in-memory object (users, products, carts, orders, etc.)
│   └── seed.js              ← seedFull() and seedMinimal() — called on boot and via /seed routes
├── middleware/
│   ├── auth.js              ← Bearer JWT verification → sets req.user
│   ├── roles.js             ← requireRole('admin') factory
│   ├── validate.js          ← Joi schema middleware, target: body|query|params
│   └── requestId.js         ← Attaches X-Request-Id to every request/response
├── routes/
│   ├── auth.js              ← /v1/auth/*
│   ├── categories.js        ← /v1/categories/*
│   ├── products.js          ← /v1/products/*
│   ├── cart.js              ← /v1/cart/*
│   ├── orders.js            ← /v1/orders/*
│   ├── users.js             ← /v1/users/*
│   └── seed.js              ← /v1/seed/*
└── utils/
    ├── jwt.js               ← signAccess, signRefresh, verifyAccess, verifyRefresh
    └── errors.js            ← problem(res, opts) → RFC 7807 application/problem+json
swagger.yaml                 ← OpenAPI 3.0 full spec — update server URL after deploying
```

---

## In-Memory Store Shape (`src/db/store.js`)
```js
store = {
  users:           [],          // { id, name, email, passwordHash, role, deleted, createdAt }
  categories:      [],          // { id, name, description, createdAt }
  products:        [],          // { id, name, description, price, stock, categoryId, imageBuffer, imageMimeType, createdAt }
  carts:           {},          // { [userId]: { items: [{ id, productId, quantity }] } }
  orders:          [],          // { id, userId, items[], total, status, createdAt, updatedAt }
  refreshTokens:   Set,         // raw refresh token strings (revoked on logout)
  idempotencyKeys: Map,         // idempotencyKey string → order object
  loginAttempts:   Map,         // ip → { count, windowStart }
  counters:        {}           // { users, categories, products, orders, cartItems } — auto-increment IDs
}
```
`nextId(entity)` increments and returns `store.counters[entity]`.
`resetStore()` mutates properties in-place so all module references stay valid.

---

## Seeded Data (restored via `POST /v1/seed/reset`)
| Role  | Email           | Password   | ID |
|-------|-----------------|------------|----|
| admin | admin@test.com  | Admin123!  | 1  |
| user  | user@test.com   | User123!   | 2  |
| user  | user2@test.com  | User123!   | 3  |

**4 categories** (ids 1–4): Electronics, Clothing, Books, Home & Garden  
**11 products** (ids 1–11): mix of in-stock and 1 zero-stock item (id 11, used for stock-error testing)

---

## API Routes Reference

### Base URL
- Local: `http://localhost:3000/v1`
- Production: `https://YOUR-APP.onrender.com/v1`

### Auth — `/v1/auth`
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | /register | — | 201+JWT; role always 'user' (mass assign blocked); 409 duplicate email |
| POST | /login | — | 200+JWT; rate limited 5 req/15min/IP; 401 on bad creds; 429 on limit hit |
| POST | /refresh | — | needs body `{ refreshToken }`; returns new accessToken |
| POST | /logout | Bearer | revokes refreshToken from store |
| GET  | /me | Bearer | returns current user object |

### Categories — `/v1/categories`
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | / | — | offset paginated; `Cache-Control: public, max-age=60` |
| POST | / | admin | 201 + Location header |
| GET | /:id | — | 404 if missing |
| PUT | /:id | admin | full replace — all fields required |
| DELETE | /:id | admin | 204 |

### Products — `/v1/products`
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | / | — | filter: `?categoryId` `?search`; sort: `?sortBy` `?order`; offset: `?page&limit`; cursor: `?cursor&limit`; fault: `?_delay=ms` `?_fail=code`; ETag/304 |
| POST | / | admin | validates categoryId exists |
| GET | /:id | — | ETag/304; fault sim on single product |
| PUT | /:id | admin | full replace |
| PATCH | /:id | admin | partial update — min 1 field required |
| DELETE | /:id | admin | 204 |
| POST | /:id/image | admin | multipart field `image`; 5MB max; JPEG/PNG/WebP; stores buffer in memory |
| GET | /:id/image | — | serves raw buffer with correct Content-Type |

### Cart — `/v1/cart`
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | / | Bearer | returns enriched cart with product details + total |
| DELETE | / | Bearer | clears entire cart |
| POST | /items | Bearer | adds or increments; 422 if stock insufficient |
| PUT | /items/:itemId | Bearer | set exact quantity; 422 if stock insufficient |
| DELETE | /items/:itemId | Bearer | removes single item; 404 if not in this user's cart |

### Orders — `/v1/orders`
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | / | Bearer | checkout; validates stock, snapshots prices, decrements stock, clears cart; `Idempotency-Key` header supported |
| GET | / | Bearer | user sees own orders; admin sees all; filter `?status`; offset + cursor pagination |
| GET | /:id | Bearer | BOLA: user can only see own orders → 403; fault sim: `?_delay` `?_fail` |
| PATCH | /:id/status | admin | state machine (see below) |
| POST | /:id/cancel | Bearer | owner or admin; 409 if shipped/delivered; restores stock on cancel |

**Order state machine:**
```
pending → confirmed | cancelled
confirmed → shipped | cancelled
shipped → delivered
delivered → (terminal)
cancelled → (terminal)
```

### Users — `/v1/users`
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | /me | Bearer | own profile |
| PATCH | /me | Bearer | partial update name/email; role field silently stripped |
| PUT | /me/password | Bearer | requires oldPassword; 400 if wrong |
| DELETE | /me | Bearer | soft delete (deleted=true); subsequent login → 401 |
| GET | /:id | admin | 404 if not found |

### Seed — `/v1/seed`
| Method | Path | Notes |
|--------|------|-------|
| POST | /reset | full wipe + re-seed (3 users, 4 categories, 11 products) |
| POST | /minimal | wipe + seed users only (no products/categories) |

---

## Error Format — RFC 7807
All errors return `Content-Type: application/problem+json`:
```json
{
  "type": "http://localhost:3000/errors/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "Product with id 99 does not exist",
  "instance": "/v1/products/99"
}
```
Validation errors (422) include an extra `errors[]` array with per-field detail.

---

## Response Headers Worth Testing
| Header | Present on |
|--------|-----------|
| `X-Request-Id` | Every response |
| `X-RateLimit-Limit` | POST /auth/login |
| `X-RateLimit-Remaining` | POST /auth/login |
| `Retry-After` | 429 responses |
| `ETag` | GET /products, GET /products/:id |
| `Cache-Control` | GET /products, GET /categories, GET /products/:id/image |
| `Location` | All 201 responses |

---

## Testing Hooks
| Hook | How |
|------|-----|
| Slow response | `?_delay=3000` (max 10000ms) on GET /products, GET /products/:id, GET /orders/:id |
| Force error | `?_fail=503` (any 4xx/5xx) on same endpoints |
| Idempotency | `Idempotency-Key: <uuid>` header on POST /orders |
| ETag caching | `If-None-Match: <etag>` header on GET /products endpoints |
| Reset state | `POST /v1/seed/reset` — call in beforeEach/BeforeEach |
| Minimal state | `POST /v1/seed/minimal` — only users, no products |

---

## Security Behaviours to Test
| Scenario | Expected |
|----------|----------|
| No Authorization header | 401 |
| Expired access token | 401 with "expired" detail |
| `alg:none` JWT | 401 (verifyAccess enforces `algorithms: ['HS256']`) |
| User accessing admin route | 403 |
| User accessing another user's order | 403 (BOLA/IDOR) |
| Register with `role: admin` in body | Ignored — role always set to 'user' |
| PATCH /users/me with `role` in body | Role field stripped by Joi schema |
| Login 5 wrong passwords from same IP | 6th attempt → 429 |
| `/products?search='; DROP TABLE--` | 200 (literal string match, no SQL) |
| Soft-deleted user tries to login | 401 |

---

## Environment Variables
| Variable | Default | Notes |
|----------|---------|-------|
| `PORT` | 3000 | |
| `JWT_SECRET` | `dev-access-secret-change-in-prod` | Access token signing key |
| `JWT_REFRESH_SECRET` | `dev-refresh-secret-change-in-prod` | Refresh token signing key |
| `BASE_URL` | `http://localhost:3000` | Used in RFC 7807 `type` URLs |
| `NODE_ENV` | `development` | Set to `production` on Render |

---

## Running Locally
```bash
npm install
npm start        # node src/app.js
npm run dev      # nodemon src/app.js (watch mode)
```

Swagger UI: `http://localhost:3000/docs`  
Health check: `http://localhost:3000/health`

---

## Deploying to Render (free tier)
1. Push repo to GitHub
2. Render → New Web Service → connect repo
3. Build command: `npm install`
4. Start command: `node src/app.js`
5. Add env vars: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `NODE_ENV=production`, `BASE_URL=https://your-app.onrender.com`
6. Update `swagger.yaml` server URL (line ~32) with the Render URL

Note: Free tier spins down after 15min inactivity. First request after sleep takes ~30s. Irrelevant for test runs (one warm-up call wakes it).

---

## Key Design Decisions
- **In-memory only** — no DB setup needed anywhere; `POST /v1/seed/reset` restores state between test suites
- **Deterministic integer IDs** — no random UUIDs; seed always produces same IDs (users 1–3, categories 1–4, products 1–11)
- **RFC 7807 errors** — consistent error schema; every error is assertable by `type`, `title`, `status`, `detail`
- **Stock is real** — checkout decrements stock; cancel restores it; over-ordering returns 422
- **Image buffer in memory** — product images stored as Buffer in the store object, served as binary on GET
- **Rate limit is IP-based** — `req.ip`; resets per window or on `POST /seed/reset`
