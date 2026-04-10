'use strict';

const express  = require('express');
const bcrypt   = require('bcryptjs');
const Joi      = require('joi');
const router   = express.Router();

const { store, nextId }              = require('../db/store');
const { signAccess, signRefresh, verifyRefresh } = require('../utils/jwt');
const { problem }                    = require('../utils/errors');
const authMiddleware                 = require('../middleware/auth');
const validate                       = require('../middleware/validate');

const RATE_LIMIT       = 5;
const RATE_WINDOW_MS   = 15 * 60 * 1000; // 15 minutes

// ── Schemas ───────────────────────────────────────────────────────────────────
const registerSchema = Joi.object({
  name:     Joi.string().min(2).max(100).required(),
  email:    Joi.string().email().required(),
  password: Joi.string().min(8).required()
});

const loginSchema = Joi.object({
  email:    Joi.string().email().required(),
  password: Joi.string().required()
});

const refreshSchema = Joi.object({
  refreshToken: Joi.string().required()
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function safeUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt };
}

function getRateLimitEntry(ip) {
  const now = Date.now();
  if (!store.loginAttempts.has(ip)) {
    store.loginAttempts.set(ip, { count: 0, windowStart: now });
  }
  const entry = store.loginAttempts.get(ip);
  if (now - entry.windowStart > RATE_WINDOW_MS) {
    entry.count       = 0;
    entry.windowStart = now;
  }
  return entry;
}

// ── POST /auth/register ───────────────────────────────────────────────────────
router.post('/register', validate(registerSchema), async (req, res) => {
  const { name, email, password } = req.body;

  if (store.users.find(u => u.email === email)) {
    return problem(res, {
      status:   409,
      title:    'Conflict',
      detail:   `A user with email '${email}' already exists`,
      instance: req.path
    });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id:           nextId('users'),
    name,
    email,
    passwordHash,
    role:         'user',   // mass assignment protection — role is always 'user' on register
    deleted:      false,
    createdAt:    new Date().toISOString()
  };
  store.users.push(user);

  const accessToken  = signAccess({ sub: user.id, role: user.role });
  const refreshToken = signRefresh({ sub: user.id });
  store.refreshTokens.add(refreshToken);

  return res
    .status(201)
    .set('Location', `/v1/users/${user.id}`)
    .json({ user: safeUser(user), accessToken, refreshToken });
});

// ── POST /auth/login ──────────────────────────────────────────────────────────
router.post('/login', validate(loginSchema), async (req, res) => {
  const ip    = req.ip;
  const entry = getRateLimitEntry(ip);
  const remaining = Math.max(0, RATE_LIMIT - entry.count);

  res.set('X-RateLimit-Limit',     String(RATE_LIMIT));
  res.set('X-RateLimit-Remaining', String(remaining));

  if (entry.count >= RATE_LIMIT) {
    const retryAfter = Math.ceil((entry.windowStart + RATE_WINDOW_MS - Date.now()) / 1000);
    res.set('Retry-After', String(retryAfter));
    return problem(res, {
      status:   429,
      title:    'Too Many Requests',
      detail:   'Too many failed login attempts. Try again in 15 minutes.',
      instance: req.path,
      extra:    { retryAfterSeconds: retryAfter }
    });
  }

  const { email, password } = req.body;
  const user = store.users.find(u => u.email === email);

  const validPassword = user && !user.deleted && await bcrypt.compare(password, user.passwordHash);
  if (!validPassword) {
    entry.count++;
    res.set('X-RateLimit-Remaining', String(Math.max(0, RATE_LIMIT - entry.count)));
    return problem(res, {
      status:   401,
      title:    'Unauthorized',
      detail:   'Invalid email or password',
      instance: req.path
    });
  }

  // Success — reset attempt counter
  entry.count = 0;

  const accessToken  = signAccess({ sub: user.id, role: user.role });
  const refreshToken = signRefresh({ sub: user.id });
  store.refreshTokens.add(refreshToken);

  return res.status(200).json({ user: safeUser(user), accessToken, refreshToken });
});

// ── POST /auth/refresh ────────────────────────────────────────────────────────
router.post('/refresh', validate(refreshSchema), (req, res) => {
  const { refreshToken } = req.body;

  if (!store.refreshTokens.has(refreshToken)) {
    return problem(res, {
      status:   401,
      title:    'Unauthorized',
      detail:   'Refresh token is invalid or has been revoked',
      instance: req.path
    });
  }

  let payload;
  try {
    payload = verifyRefresh(refreshToken);
  } catch (err) {
    store.refreshTokens.delete(refreshToken);
    return problem(res, {
      status:   401,
      title:    'Unauthorized',
      detail:   err.name === 'TokenExpiredError' ? 'Refresh token has expired' : 'Invalid refresh token',
      instance: req.path
    });
  }

  const user = store.users.find(u => u.id === payload.sub && !u.deleted);
  if (!user) {
    return problem(res, {
      status:   401,
      title:    'Unauthorized',
      detail:   'User account no longer exists',
      instance: req.path
    });
  }

  const accessToken = signAccess({ sub: user.id, role: user.role });
  return res.status(200).json({ accessToken });
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────
router.post('/logout', authMiddleware, (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) {
    store.refreshTokens.delete(refreshToken);
  }
  return res.status(204).send();
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────
router.get('/me', authMiddleware, (req, res) => {
  return res.status(200).json(safeUser(req.user));
});

module.exports = router;
