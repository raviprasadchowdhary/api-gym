'use strict';

const express  = require('express');
const Joi      = require('joi');
const router   = express.Router();

const { store, nextId } = require('../db/store');
const { problem }       = require('../utils/errors');
const authMiddleware    = require('../middleware/auth');
const requireRole       = require('../middleware/roles');
const validate          = require('../middleware/validate');

// ── Order status state machine ────────────────────────────────────────────────
// pending → confirmed → shipped → delivered
// pending | confirmed → cancelled
const TRANSITIONS = {
  pending:   ['confirmed', 'cancelled'],
  confirmed: ['shipped',   'cancelled'],
  shipped:   ['delivered'],
  delivered: [],
  cancelled: []
};

// ── Schemas ───────────────────────────────────────────────────────────────────
const statusSchema = Joi.object({
  status: Joi.string().valid('confirmed', 'shipped', 'delivered', 'cancelled').required()
});

// ── POST /orders (checkout) ───────────────────────────────────────────────────
router.post('/', authMiddleware, (req, res) => {
  // Idempotency-Key — same key returns same 201 response (no duplicate order)
  const idempotencyKey = req.headers['idempotency-key'];
  if (idempotencyKey && store.idempotencyKeys.has(idempotencyKey)) {
    const cached = store.idempotencyKeys.get(idempotencyKey);
    return res.status(201).set('Location', `/v1/orders/${cached.id}`).json(cached);
  }

  const cart = store.carts[req.user.id];
  if (!cart || cart.items.length === 0) {
    return problem(res, { status: 400, title: 'Bad Request', detail: 'Cannot checkout with an empty cart', instance: req.path });
  }

  // Validate stock and snapshot items at checkout time
  const orderItems = [];
  let total = 0;

  for (const item of cart.items) {
    const product = store.products.find(p => p.id === item.productId);
    if (!product) {
      return problem(res, { status: 422, title: 'Product Unavailable', detail: `Product id ${item.productId} no longer exists`, instance: req.path });
    }
    if (product.stock < item.quantity) {
      return problem(res, {
        status:   422,
        title:    'Insufficient Stock',
        detail:   `Insufficient stock for "${product.name}"`,
        instance: req.path,
        extra:    { productId: product.id, available: product.stock, requested: item.quantity }
      });
    }
    orderItems.push({
      productId:   product.id,
      productName: product.name,
      price:       product.price,
      quantity:    item.quantity,
      subtotal:    parseFloat((product.price * item.quantity).toFixed(2))
    });
    total += product.price * item.quantity;
  }

  // Decrement stock
  for (const item of orderItems) {
    const product = store.products.find(p => p.id === item.productId);
    product.stock -= item.quantity;
  }

  const order = {
    id:        nextId('orders'),
    userId:    req.user.id,
    items:     orderItems,
    total:     parseFloat(total.toFixed(2)),
    status:    'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  store.orders.push(order);
  store.carts[req.user.id] = { items: [] };

  if (idempotencyKey) {
    store.idempotencyKeys.set(idempotencyKey, order);
  }

  return res.status(201).set('Location', `/v1/orders/${order.id}`).json(order);
});

// ── GET /orders ───────────────────────────────────────────────────────────────
router.get('/', authMiddleware, (req, res) => {
  const { page, limit = '10', cursor, status } = req.query;
  const isAdmin = req.user.role === 'admin';

  let orders = isAdmin
    ? [...store.orders]
    : store.orders.filter(o => o.userId === req.user.id);

  if (status) {
    orders = orders.filter(o => o.status === status);
  }

  const lim = Math.min(100, Math.max(1, parseInt(limit) || 10));

  if (cursor !== undefined) {
    const cursorId   = parseInt(cursor);
    const startIdx   = cursorId ? orders.findIndex(o => o.id === cursorId) + 1 : 0;
    const data       = orders.slice(startIdx, startIdx + lim);
    const nextCursor = data.length === lim ? data[data.length - 1].id : null;
    return res.status(200).json({ data, pagination: { type: 'cursor', limit: lim, nextCursor, hasNext: nextCursor !== null } });
  }

  const p          = Math.max(1, parseInt(page) || 1);
  const total      = orders.length;
  const totalPages = Math.ceil(total / lim) || 1;
  const data       = orders.slice((p - 1) * lim, p * lim);
  return res.status(200).json({ data, pagination: { type: 'offset', page: p, limit: lim, total, totalPages, hasNext: p < totalPages, hasPrev: p > 1 } });
});

// ── GET /orders/:id ───────────────────────────────────────────────────────────
router.get('/:id', authMiddleware, async (req, res) => {
  const { _delay, _fail } = req.query;

  if (_fail) {
    const code = Math.min(599, Math.max(400, parseInt(_fail) || 500));
    return problem(res, { status: code, title: 'Simulated Error', detail: `Simulated ${code} error`, instance: req.path });
  }
  if (_delay) {
    await new Promise(r => setTimeout(r, Math.min(parseInt(_delay) || 0, 10000)));
  }

  const id    = parseInt(req.params.id);
  const order = store.orders.find(o => o.id === id);
  if (!order) {
    return problem(res, { status: 404, title: 'Not Found', detail: `Order with id ${id} does not exist`, instance: req.path });
  }

  // BOLA / IDOR protection — users can only see their own orders
  if (req.user.role !== 'admin' && order.userId !== req.user.id) {
    return problem(res, { status: 403, title: 'Forbidden', detail: 'You do not have access to this order', instance: req.path });
  }

  return res.status(200).json(order);
});

// ── PATCH /orders/:id/status (admin — state machine) ─────────────────────────
router.patch('/:id/status', authMiddleware, requireRole('admin'), validate(statusSchema), (req, res) => {
  const id    = parseInt(req.params.id);
  const order = store.orders.find(o => o.id === id);
  if (!order) {
    return problem(res, { status: 404, title: 'Not Found', detail: `Order with id ${id} does not exist`, instance: req.path });
  }

  const { status } = req.body;
  const allowed    = TRANSITIONS[order.status] || [];
  if (!allowed.includes(status)) {
    return problem(res, {
      status:   422,
      title:    'Invalid State Transition',
      detail:   `Cannot move order from '${order.status}' to '${status}'`,
      instance: req.path,
      extra:    { currentStatus: order.status, requestedStatus: status, allowedTransitions: allowed }
    });
  }

  order.status    = status;
  order.updatedAt = new Date().toISOString();
  return res.status(200).json(order);
});

// ── POST /orders/:id/cancel (owner or admin) ──────────────────────────────────
router.post('/:id/cancel', authMiddleware, (req, res) => {
  const id    = parseInt(req.params.id);
  const order = store.orders.find(o => o.id === id);
  if (!order) {
    return problem(res, { status: 404, title: 'Not Found', detail: `Order with id ${id} does not exist`, instance: req.path });
  }
  if (req.user.role !== 'admin' && order.userId !== req.user.id) {
    return problem(res, { status: 403, title: 'Forbidden', detail: 'You do not have access to this order', instance: req.path });
  }
  if (!TRANSITIONS[order.status]?.includes('cancelled')) {
    return problem(res, {
      status:   409,
      title:    'Conflict',
      detail:   `Order cannot be cancelled in its current status: '${order.status}'`,
      instance: req.path,
      extra:    { currentStatus: order.status }
    });
  }

  order.status    = 'cancelled';
  order.updatedAt = new Date().toISOString();

  // Restore stock
  for (const item of order.items) {
    const product = store.products.find(p => p.id === item.productId);
    if (product) product.stock += item.quantity;
  }

  return res.status(200).json(order);
});

module.exports = router;
