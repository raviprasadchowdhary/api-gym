'use strict';

const express  = require('express');
const Joi      = require('joi');
const router   = express.Router();

const { store, nextId } = require('../db/store');
const { problem }       = require('../utils/errors');
const authMiddleware    = require('../middleware/auth');
const validate          = require('../middleware/validate');

// ── Schemas ───────────────────────────────────────────────────────────────────
const addItemSchema = Joi.object({
  productId: Joi.number().integer().positive().required(),
  quantity:  Joi.number().integer().min(1).max(1000).required()
});

const updateItemSchema = Joi.object({
  quantity: Joi.number().integer().min(1).max(1000).required()
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function getCart(userId) {
  if (!store.carts[userId]) store.carts[userId] = { items: [] };
  return store.carts[userId];
}

function enrichCart(cart) {
  const items = cart.items.map(item => {
    const product = store.products.find(p => p.id === item.productId);
    return { ...item, product: product ? { id: product.id, name: product.name, price: product.price, stock: product.stock } : null };
  });
  const total = parseFloat(items.reduce((sum, i) => sum + (i.product ? i.product.price * i.quantity : 0), 0).toFixed(2));
  return { items, total, itemCount: items.length };
}

// ── GET /cart ─────────────────────────────────────────────────────────────────
router.get('/', authMiddleware, (req, res) => {
  return res.status(200).json(enrichCart(getCart(req.user.id)));
});

// ── POST /cart/items ──────────────────────────────────────────────────────────
router.post('/items', authMiddleware, validate(addItemSchema), (req, res) => {
  const { productId, quantity } = req.body;
  const product = store.products.find(p => p.id === productId);

  if (!product) {
    return problem(res, { status: 404, title: 'Not Found', detail: `Product with id ${productId} does not exist`, instance: req.path });
  }

  const cart = getCart(req.user.id);
  const existing = cart.items.find(i => i.productId === productId);
  const totalQty = quantity + (existing ? existing.quantity : 0);

  if (product.stock < totalQty) {
    return problem(res, {
      status:   422,
      title:    'Insufficient Stock',
      detail:   `Only ${product.stock} unit(s) available, ${totalQty} requested`,
      instance: req.path,
      extra:    { available: product.stock, requested: totalQty }
    });
  }

  if (existing) {
    existing.quantity += quantity;
  } else {
    cart.items.push({ id: nextId('cartItems'), productId, quantity });
  }

  return res.status(201).json(enrichCart(cart));
});

// ── PUT /cart/items/:itemId ───────────────────────────────────────────────────
router.put('/items/:itemId', authMiddleware, validate(updateItemSchema), (req, res) => {
  const itemId = parseInt(req.params.itemId);
  const cart   = getCart(req.user.id);
  const item   = cart.items.find(i => i.id === itemId);

  if (!item) {
    return problem(res, { status: 404, title: 'Not Found', detail: `Cart item with id ${itemId} not found`, instance: req.path });
  }

  const { quantity } = req.body;
  const product = store.products.find(p => p.id === item.productId);
  if (product && product.stock < quantity) {
    return problem(res, {
      status:   422,
      title:    'Insufficient Stock',
      detail:   `Only ${product.stock} unit(s) available`,
      instance: req.path,
      extra:    { available: product.stock, requested: quantity }
    });
  }

  item.quantity = quantity;
  return res.status(200).json(enrichCart(cart));
});

// ── DELETE /cart/items/:itemId ────────────────────────────────────────────────
router.delete('/items/:itemId', authMiddleware, (req, res) => {
  const itemId = parseInt(req.params.itemId);
  const cart   = getCart(req.user.id);
  const idx    = cart.items.findIndex(i => i.id === itemId);

  if (idx === -1) {
    return problem(res, { status: 404, title: 'Not Found', detail: `Cart item with id ${itemId} not found`, instance: req.path });
  }

  cart.items.splice(idx, 1);
  return res.status(204).send();
});

// ── DELETE /cart (clear entire cart) ─────────────────────────────────────────
router.delete('/', authMiddleware, (req, res) => {
  store.carts[req.user.id] = { items: [] };
  return res.status(204).send();
});

module.exports = router;
