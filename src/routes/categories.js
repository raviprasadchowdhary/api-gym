'use strict';

const express  = require('express');
const Joi      = require('joi');
const router   = express.Router();

const { store, nextId } = require('../db/store');
const { problem }       = require('../utils/errors');
const authMiddleware    = require('../middleware/auth');
const requireRole       = require('../middleware/roles');
const validate          = require('../middleware/validate');

// ── Schemas ───────────────────────────────────────────────────────────────────
const categorySchema = Joi.object({
  name:        Joi.string().min(2).max(100).required(),
  description: Joi.string().max(500).allow('').optional().default('')
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function offsetPaginate(array, page, limit) {
  const p = Math.max(1, parseInt(page) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit) || 10));
  const total      = array.length;
  const totalPages = Math.ceil(total / l) || 1;
  return {
    data:       array.slice((p - 1) * l, p * l),
    pagination: { type: 'offset', page: p, limit: l, total, totalPages, hasNext: p < totalPages, hasPrev: p > 1 }
  };
}

// ── GET /categories ───────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { page, limit } = req.query;
  const result = offsetPaginate(store.categories, page, limit);
  return res
    .status(200)
    .set('Cache-Control', 'public, max-age=60')
    .json(result);
});

// ── POST /categories ──────────────────────────────────────────────────────────
router.post('/', authMiddleware, requireRole('admin'), validate(categorySchema), (req, res) => {
  const category = {
    id:          nextId('categories'),
    name:        req.body.name,
    description: req.body.description,
    createdAt:   new Date().toISOString()
  };
  store.categories.push(category);
  return res
    .status(201)
    .set('Location', `/v1/categories/${category.id}`)
    .json(category);
});

// ── GET /categories/:id ───────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const id       = parseInt(req.params.id);
  const category = store.categories.find(c => c.id === id);
  if (!category) {
    return problem(res, { status: 404, title: 'Not Found', detail: `Category with id ${id} does not exist`, instance: req.path });
  }
  return res.status(200).json(category);
});

// ── PUT /categories/:id (full replace) ────────────────────────────────────────
router.put('/:id', authMiddleware, requireRole('admin'), validate(categorySchema), (req, res) => {
  const id  = parseInt(req.params.id);
  const idx = store.categories.findIndex(c => c.id === id);
  if (idx === -1) {
    return problem(res, { status: 404, title: 'Not Found', detail: `Category with id ${id} does not exist`, instance: req.path });
  }
  store.categories[idx] = {
    id,
    name:        req.body.name,
    description: req.body.description,
    createdAt:   store.categories[idx].createdAt,
    updatedAt:   new Date().toISOString()
  };
  return res.status(200).json(store.categories[idx]);
});

// ── DELETE /categories/:id ────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, requireRole('admin'), (req, res) => {
  const id  = parseInt(req.params.id);
  const idx = store.categories.findIndex(c => c.id === id);
  if (idx === -1) {
    return problem(res, { status: 404, title: 'Not Found', detail: `Category with id ${id} does not exist`, instance: req.path });
  }
  store.categories.splice(idx, 1);
  return res.status(204).send();
});

module.exports = router;
