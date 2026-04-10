'use strict';

/**
 * In-memory store — single shared object. All modules reference this same instance.
 * resetStore() mutates properties in-place so existing references stay valid.
 */
const store = {
  users: [],
  categories: [],
  products: [],
  carts: {},          // { [userId]: { items: [{ id, productId, quantity }] } }
  orders: [],
  refreshTokens: new Set(),
  idempotencyKeys: new Map(),     // idempotencyKey -> order object
  loginAttempts: new Map(),       // ip -> { count, windowStart }
  counters: { users: 0, categories: 0, products: 0, orders: 0, cartItems: 0 }
};

function nextId(entity) {
  store.counters[entity] += 1;
  return store.counters[entity];
}

function resetStore() {
  store.users = [];
  store.categories = [];
  store.products = [];
  store.carts = {};
  store.orders = [];
  store.refreshTokens = new Set();
  store.idempotencyKeys = new Map();
  store.loginAttempts = new Map();
  store.counters = { users: 0, categories: 0, products: 0, orders: 0, cartItems: 0 };
}

module.exports = { store, nextId, resetStore };
