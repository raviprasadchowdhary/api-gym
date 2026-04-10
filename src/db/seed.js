'use strict';

const bcrypt = require('bcryptjs');
const { store, nextId, resetStore } = require('./store');

async function seedFull() {
  resetStore();

  const adminHash = await bcrypt.hash('Admin123!', 10);
  const userHash  = await bcrypt.hash('User123!', 10);
  const now = new Date().toISOString();

  // ── Users ────────────────────────────────────────────────────────────────
  store.users.push(
    { id: nextId('users'), name: 'Admin User',   email: 'admin@test.com',  passwordHash: adminHash, role: 'admin', deleted: false, createdAt: now },
    { id: nextId('users'), name: 'Test User',    email: 'user@test.com',   passwordHash: userHash,  role: 'user',  deleted: false, createdAt: now },
    { id: nextId('users'), name: 'Second User',  email: 'user2@test.com',  passwordHash: userHash,  role: 'user',  deleted: false, createdAt: now }
  );

  // ── Categories ───────────────────────────────────────────────────────────
  store.categories.push(
    { id: nextId('categories'), name: 'Electronics',    description: 'Gadgets and devices',          createdAt: now },
    { id: nextId('categories'), name: 'Clothing',       description: 'Apparel and fashion',          createdAt: now },
    { id: nextId('categories'), name: 'Books',          description: 'Print and digital books',      createdAt: now },
    { id: nextId('categories'), name: 'Home & Garden',  description: 'Home improvement and garden',  createdAt: now }
  );

  // ── Products ─────────────────────────────────────────────────────────────
  store.products.push(
    { id: nextId('products'), name: 'Smartphone Pro X',       description: 'Latest flagship smartphone with advanced camera and AI features', price: 999.99,  stock: 50,  categoryId: 1, imageBuffer: null, imageMimeType: null, createdAt: now },
    { id: nextId('products'), name: 'Wireless Headphones',    description: 'Noise cancelling over-ear headphones with 40h battery',             price: 249.99,  stock: 100, categoryId: 1, imageBuffer: null, imageMimeType: null, createdAt: now },
    { id: nextId('products'), name: 'Laptop Ultra',           description: 'Thin and light professional laptop with 16GB RAM, 512GB SSD',       price: 1299.99, stock: 30,  categoryId: 1, imageBuffer: null, imageMimeType: null, createdAt: now },
    { id: nextId('products'), name: 'Mechanical Keyboard',    description: 'RGB mechanical keyboard with Cherry MX switches',                   price: 149.99,  stock: 75,  categoryId: 1, imageBuffer: null, imageMimeType: null, createdAt: now },
    { id: nextId('products'), name: 'Running Shoes',          description: 'Lightweight running shoes for all terrains',                        price: 89.99,   stock: 200, categoryId: 2, imageBuffer: null, imageMimeType: null, createdAt: now },
    { id: nextId('products'), name: 'Denim Jacket',           description: 'Classic blue denim jacket with authentic wash',                     price: 59.99,   stock: 150, categoryId: 2, imageBuffer: null, imageMimeType: null, createdAt: now },
    { id: nextId('products'), name: 'Clean Code',             description: 'A handbook of agile software craftsmanship by Robert C. Martin',    price: 34.99,   stock: 500, categoryId: 3, imageBuffer: null, imageMimeType: null, createdAt: now },
    { id: nextId('products'), name: 'The Pragmatic Programmer',description: 'Your journey to mastery by David Thomas and Andrew Hunt',          price: 39.99,   stock: 300, categoryId: 3, imageBuffer: null, imageMimeType: null, createdAt: now },
    { id: nextId('products'), name: 'Garden Hose 50ft',       description: 'Flexible and durable garden hose with brass fittings',              price: 29.99,   stock: 80,  categoryId: 4, imageBuffer: null, imageMimeType: null, createdAt: now },
    { id: nextId('products'), name: 'Plant Pot Set',          description: 'Set of 5 ceramic plant pots in various sizes',                      price: 44.99,   stock: 120, categoryId: 4, imageBuffer: null, imageMimeType: null, createdAt: now },
    { id: nextId('products'), name: 'Out of Stock Item',      description: 'This item has zero stock — used to test insufficient stock flows',  price: 19.99,   stock: 0,   categoryId: 1, imageBuffer: null, imageMimeType: null, createdAt: now }
  );
}

async function seedMinimal() {
  resetStore();

  const adminHash = await bcrypt.hash('Admin123!', 10);
  const userHash  = await bcrypt.hash('User123!', 10);
  const now = new Date().toISOString();

  store.users.push(
    { id: nextId('users'), name: 'Admin User',  email: 'admin@test.com',  passwordHash: adminHash, role: 'admin', deleted: false, createdAt: now },
    { id: nextId('users'), name: 'Test User',   email: 'user@test.com',   passwordHash: userHash,  role: 'user',  deleted: false, createdAt: now },
    { id: nextId('users'), name: 'Second User', email: 'user2@test.com',  passwordHash: userHash,  role: 'user',  deleted: false, createdAt: now }
  );
}

module.exports = { seedFull, seedMinimal };
