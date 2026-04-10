'use strict';

require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const morgan       = require('morgan');
const yaml         = require('js-yaml');
const swaggerUi    = require('swagger-ui-express');
const fs           = require('fs');
const path         = require('path');

const requestId    = require('./middleware/requestId');
const { problem }  = require('./utils/errors');
const { seedFull } = require('./db/seed');

const authRoutes        = require('./routes/auth');
const categoriesRoutes  = require('./routes/categories');
const productsRoutes    = require('./routes/products');
const cartRoutes        = require('./routes/cart');
const ordersRoutes      = require('./routes/orders');
const usersRoutes       = require('./routes/users');
const seedRoutes        = require('./routes/seed');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Swagger docs ──────────────────────────────────────────────────────────────
const swaggerDoc = yaml.load(fs.readFileSync(path.join(__dirname, '../swagger.yaml'), 'utf8'));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc, {
  customSiteTitle: 'E-Commerce API — Testing Practice'
}));

// ── Global middleware ─────────────────────────────────────────────────────────
app.use(cors({
  origin:         '*',
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key', 'If-None-Match'],
  exposedHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'ETag', 'Location', 'Cache-Control', 'Retry-After']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));
app.use(requestId);

// Security headers
app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  next();
});

// 415 Unsupported Media Type — only checked when there is a body
app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const len  = parseInt(req.headers['content-length'] || '0');
    const isChunked = (req.headers['transfer-encoding'] || '').includes('chunked');
    const ct   = req.headers['content-type'] || '';
    if ((len > 0 || isChunked) &&
        !ct.includes('application/json') &&
        !ct.includes('multipart/form-data') &&
        !ct.includes('application/x-www-form-urlencoded')) {
      return problem(res, {
        status:   415,
        title:    'Unsupported Media Type',
        detail:   'Content-Type must be application/json (or multipart/form-data for file uploads)',
        instance: req.path
      });
    }
  }
  next();
});

// HEAD → GET conversion — Express sends empty body automatically for HEAD
app.use((req, _res, next) => {
  if (req.method === 'HEAD') req.method = 'GET';
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.status(200).json({
    name:    'E-Commerce API — Testing Practice',
    version: '1.0.0',
    docs:    '/docs',
    health:  '/health',
    api:     '/v1',
    seed:    'POST /v1/seed/reset'
  });
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    status:    'ok',
    uptime:    process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.use('/v1/auth',        authRoutes);
app.use('/v1/categories',  categoriesRoutes);
app.use('/v1/products',    productsRoutes);
app.use('/v1/cart',        cartRoutes);
app.use('/v1/orders',      ordersRoutes);
app.use('/v1/users',       usersRoutes);
app.use('/v1/seed',        seedRoutes);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  problem(res, {
    status:   404,
    title:    'Not Found',
    detail:   `${req.method} ${req.path} does not match any route`,
    instance: req.path
  });
});

// ── Error handlers ────────────────────────────────────────────────────────────
// 413 from express.json()
app.use((err, req, res, next) => {
  if (err.status === 413 || err.type === 'entity.too.large') {
    return problem(res, { status: 413, title: 'Payload Too Large', detail: 'Request body exceeds size limit', instance: req.path });
  }
  next(err);
});

// Catch-all
app.use((err, req, res, _next) => {
  console.error(err);
  problem(res, {
    status:   500,
    title:    'Internal Server Error',
    detail:   process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message,
    instance: req.path
  });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
seedFull().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running  → http://localhost:${PORT}`);
    console.log(`Swagger UI      → http://localhost:${PORT}/docs`);
    console.log(`Health check    → http://localhost:${PORT}/health`);
    console.log(`Seed reset      → POST http://localhost:${PORT}/v1/seed/reset`);
  });
}).catch(err => {
  console.error('Failed to seed:', err);
  process.exit(1);
});

module.exports = app;
