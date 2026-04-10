'use strict';

const express  = require('express');
const Joi      = require('joi');
const bcrypt   = require('bcryptjs');
const router   = express.Router();

const { store }      = require('../db/store');
const { problem }    = require('../utils/errors');
const authMiddleware = require('../middleware/auth');
const requireRole    = require('../middleware/roles');
const validate       = require('../middleware/validate');

// ── Schemas ───────────────────────────────────────────────────────────────────
// Note: 'role' is intentionally excluded — demonstrates mass assignment protection
const updateMeSchema = Joi.object({
  name:  Joi.string().min(2).max(100).optional(),
  email: Joi.string().email().optional()
}).min(1);

const passwordSchema = Joi.object({
  oldPassword: Joi.string().required(),
  newPassword: Joi.string().min(8).required()
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function safeUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt };
}

// ── GET /users/me ─────────────────────────────────────────────────────────────
router.get('/me', authMiddleware, (req, res) => {
  return res.status(200).json(safeUser(req.user));
});

// ── PATCH /users/me ───────────────────────────────────────────────────────────
router.patch('/me', authMiddleware, validate(updateMeSchema), (req, res) => {
  const { name, email } = req.body;  // role is stripped by Joi — mass assignment is blocked
  const idx = store.users.findIndex(u => u.id === req.user.id);

  if (email && email !== req.user.email) {
    const taken = store.users.find(u => u.email === email && u.id !== req.user.id);
    if (taken) {
      return problem(res, { status: 409, title: 'Conflict', detail: `Email '${email}' is already in use`, instance: req.path });
    }
  }

  if (name)  store.users[idx].name  = name;
  if (email) store.users[idx].email = email;
  store.users[idx].updatedAt = new Date().toISOString();

  return res.status(200).json(safeUser(store.users[idx]));
});

// ── PUT /users/me/password ────────────────────────────────────────────────────
router.put('/me/password', authMiddleware, validate(passwordSchema), async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const idx = store.users.findIndex(u => u.id === req.user.id);

  const valid = await bcrypt.compare(oldPassword, store.users[idx].passwordHash);
  if (!valid) {
    return problem(res, { status: 400, title: 'Bad Request', detail: 'Old password is incorrect', instance: req.path });
  }

  store.users[idx].passwordHash = await bcrypt.hash(newPassword, 10);
  store.users[idx].updatedAt    = new Date().toISOString();
  return res.status(204).send();
});

// ── DELETE /users/me (soft delete) ────────────────────────────────────────────
router.delete('/me', authMiddleware, (req, res) => {
  const idx = store.users.findIndex(u => u.id === req.user.id);
  store.users[idx].deleted   = true;
  store.users[idx].deletedAt = new Date().toISOString();
  // Auth middleware checks deleted=true, so subsequent requests with this user's token → 401
  return res.status(204).send();
});

// ── GET /users/:id (admin only) ───────────────────────────────────────────────
router.get('/:id', authMiddleware, requireRole('admin'), (req, res) => {
  const id   = parseInt(req.params.id);
  const user = store.users.find(u => u.id === id);
  if (!user) {
    return problem(res, { status: 404, title: 'Not Found', detail: `User with id ${id} does not exist`, instance: req.path });
  }
  return res.status(200).json(safeUser(user));
});

module.exports = router;
