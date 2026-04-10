'use strict';

const express  = require('express');
const Joi      = require('joi');
const multer   = require('multer');
const router   = express.Router();

const { store, nextId } = require('../db/store');
const { problem }       = require('../utils/errors');
const authMiddleware    = require('../middleware/auth');
const requireRole       = require('../middleware/roles');
const validate          = require('../middleware/validate');

// ── Multer (memory storage — no disk writes needed) ───────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(Object.assign(new Error('Only JPEG, PNG, and WebP images are allowed'), { code: 'INVALID_MIME' }));
    }
    cb(null, true);
  }
});

// ── Schemas ───────────────────────────────────────────────────────────────────
const productSchema = Joi.object({
  name:        Joi.string().min(2).max(200).required(),
  description: Joi.string().max(1000).allow('').optional().default(''),
  price:       Joi.number().positive().precision(2).required(),
  stock:       Joi.number().integer().min(0).required(),
  categoryId:  Joi.number().integer().positive().required()
});

const productPatchSchema = Joi.object({
  name:        Joi.string().min(2).max(200).optional(),
  description: Joi.string().max(1000).allow('').optional(),
  price:       Joi.number().positive().precision(2).optional(),
  stock:       Joi.number().integer().min(0).optional(),
  categoryId:  Joi.number().integer().positive().optional()
}).min(1);

// ── Helpers ───────────────────────────────────────────────────────────────────
function sanitize(p) {
  // eslint-disable-next-line no-unused-vars
  const { imageBuffer, imageMimeType, ...rest } = p;
  return { ...rest, imageUrl: p.imageBuffer ? `/v1/products/${p.id}/image` : null };
}

function generateETag(data) {
  const str = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = Math.imul(31, hash) + str.charCodeAt(i) | 0;
  }
  return `"${(hash >>> 0).toString(16)}"`;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── GET /products ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { _delay, _fail, categoryId, search, sortBy = 'id', order = 'asc', page, limit = '10', cursor } = req.query;

  // Fault simulation — useful for testing timeouts and retry logic
  if (_fail) {
    const code = Math.min(599, Math.max(400, parseInt(_fail) || 500));
    return problem(res, { status: code, title: 'Simulated Error', detail: `Simulated ${code} error (triggered by ?_fail=${_fail})`, instance: req.path });
  }
  if (_delay) {
    await delay(Math.min(parseInt(_delay) || 0, 10000));
  }

  let products = store.products.map(sanitize);

  // Filter
  if (categoryId) {
    const cid = parseInt(categoryId);
    products = products.filter(p => p.categoryId === cid);
  }
  if (search) {
    // Input is treated as a literal string — no SQL, no injection risk
    const q = String(search).toLowerCase().slice(0, 200);
    products = products.filter(p =>
      p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q)
    );
  }

  // Sort
  const validSort = ['id', 'name', 'price', 'createdAt', 'stock'];
  const sortField = validSort.includes(sortBy) ? sortBy : 'id';
  const dir = order === 'desc' ? -1 : 1;
  products.sort((a, b) => {
    if (a[sortField] < b[sortField]) return -1 * dir;
    if (a[sortField] > b[sortField]) return  1 * dir;
    return 0;
  });

  // Pagination — supports both offset and cursor
  const lim = Math.min(100, Math.max(1, parseInt(limit) || 10));
  let result;

  if (cursor !== undefined) {
    const cursorId  = parseInt(cursor);
    const startIdx  = cursorId ? products.findIndex(p => p.id === cursorId) + 1 : 0;
    const data      = products.slice(startIdx, startIdx + lim);
    const nextCursor = data.length === lim ? data[data.length - 1].id : null;
    result = { data, pagination: { type: 'cursor', limit: lim, nextCursor, hasNext: nextCursor !== null } };
  } else {
    const p          = Math.max(1, parseInt(page) || 1);
    const total      = products.length;
    const totalPages = Math.ceil(total / lim) || 1;
    const data       = products.slice((p - 1) * lim, p * lim);
    result = { data, pagination: { type: 'offset', page: p, limit: lim, total, totalPages, hasNext: p < totalPages, hasPrev: p > 1 } };
  }

  const etag = generateETag(result);
  res.set('ETag', etag);
  res.set('Cache-Control', 'public, max-age=60');

  if (req.headers['if-none-match'] === etag) {
    return res.status(304).send();
  }

  return res.status(200).json(result);
});

// ── POST /products ────────────────────────────────────────────────────────────
router.post('/', authMiddleware, requireRole('admin'), validate(productSchema), (req, res) => {
  const { name, description, price, stock, categoryId } = req.body;

  if (!store.categories.find(c => c.id === categoryId)) {
    return problem(res, { status: 404, title: 'Not Found', detail: `Category with id ${categoryId} does not exist`, instance: req.path });
  }

  const product = {
    id: nextId('products'), name, description, price, stock, categoryId,
    imageBuffer: null, imageMimeType: null, createdAt: new Date().toISOString()
  };
  store.products.push(product);

  return res
    .status(201)
    .set('Location', `/v1/products/${product.id}`)
    .json(sanitize(product));
});

// ── GET /products/:id ─────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const { _delay, _fail } = req.query;

  if (_fail) {
    const code = Math.min(599, Math.max(400, parseInt(_fail) || 500));
    return problem(res, { status: code, title: 'Simulated Error', detail: `Simulated ${code} error`, instance: req.path });
  }
  if (_delay) {
    await delay(Math.min(parseInt(_delay) || 0, 10000));
  }

  const id      = parseInt(req.params.id);
  const product = store.products.find(p => p.id === id);
  if (!product) {
    return problem(res, { status: 404, title: 'Not Found', detail: `Product with id ${id} does not exist`, instance: req.path });
  }

  const sanitized = sanitize(product);
  const etag      = generateETag(sanitized);
  res.set('ETag', etag);
  res.set('Cache-Control', 'public, max-age=60');

  if (req.headers['if-none-match'] === etag) {
    return res.status(304).send();
  }

  return res.status(200).json(sanitized);
});

// ── PUT /products/:id (full replace) ─────────────────────────────────────────
router.put('/:id', authMiddleware, requireRole('admin'), validate(productSchema), (req, res) => {
  const id  = parseInt(req.params.id);
  const idx = store.products.findIndex(p => p.id === id);
  if (idx === -1) {
    return problem(res, { status: 404, title: 'Not Found', detail: `Product with id ${id} does not exist`, instance: req.path });
  }

  const { name, description, price, stock, categoryId } = req.body;
  store.products[idx] = {
    id, name, description, price, stock, categoryId,
    imageBuffer:   store.products[idx].imageBuffer,
    imageMimeType: store.products[idx].imageMimeType,
    createdAt:     store.products[idx].createdAt,
    updatedAt:     new Date().toISOString()
  };

  return res.status(200).json(sanitize(store.products[idx]));
});

// ── PATCH /products/:id (partial update) ─────────────────────────────────────
router.patch('/:id', authMiddleware, requireRole('admin'), validate(productPatchSchema), (req, res) => {
  const id  = parseInt(req.params.id);
  const idx = store.products.findIndex(p => p.id === id);
  if (idx === -1) {
    return problem(res, { status: 404, title: 'Not Found', detail: `Product with id ${id} does not exist`, instance: req.path });
  }

  store.products[idx] = { ...store.products[idx], ...req.body, id, updatedAt: new Date().toISOString() };
  return res.status(200).json(sanitize(store.products[idx]));
});

// ── DELETE /products/:id ──────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, requireRole('admin'), (req, res) => {
  const id  = parseInt(req.params.id);
  const idx = store.products.findIndex(p => p.id === id);
  if (idx === -1) {
    return problem(res, { status: 404, title: 'Not Found', detail: `Product with id ${id} does not exist`, instance: req.path });
  }
  store.products.splice(idx, 1);
  return res.status(204).send();
});

// ── POST /products/:id/image (multipart upload) ───────────────────────────────
router.post('/:id/image', authMiddleware, requireRole('admin'),
  (req, res, next) => {
    const id  = parseInt(req.params.id);
    const idx = store.products.findIndex(p => p.id === id);
    if (idx === -1) {
      return problem(res, { status: 404, title: 'Not Found', detail: `Product with id ${id} does not exist`, instance: req.path });
    }
    req._productIdx = idx;
    next();
  },
  (req, res, next) => {
    upload.single('image')(req, res, err => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return problem(res, { status: 413, title: 'Payload Too Large', detail: 'Image must be under 5 MB', instance: req.path });
        }
        return problem(res, { status: 422, title: 'Validation Error', detail: err.message, instance: req.path });
      }
      next();
    });
  },
  (req, res) => {
    if (!req.file) {
      return problem(res, { status: 422, title: 'Validation Error', detail: 'No image provided. Use multipart field name "image"', instance: req.path });
    }
    const id  = parseInt(req.params.id);
    const idx = req._productIdx;
    store.products[idx].imageBuffer   = req.file.buffer;
    store.products[idx].imageMimeType = req.file.mimetype;
    return res.status(200).json({
      imageUrl:  `/v1/products/${id}/image`,
      filename:  req.file.originalname,
      size:      req.file.size,
      mimeType:  req.file.mimetype
    });
  }
);

// ── GET /products/:id/image ───────────────────────────────────────────────────
router.get('/:id/image', (req, res) => {
  const id      = parseInt(req.params.id);
  const product = store.products.find(p => p.id === id);
  if (!product || !product.imageBuffer) {
    return problem(res, { status: 404, title: 'Not Found', detail: 'No image uploaded for this product', instance: req.path });
  }
  res.set('Content-Type',   product.imageMimeType || 'image/jpeg');
  res.set('Content-Length', String(product.imageBuffer.length));
  res.set('Cache-Control',  'public, max-age=3600');
  return res.end(product.imageBuffer);
});

module.exports = router;
