/**
 * Online Organic Food System - Node.js (Express + SQLite) backend.
 *
 * Run:
 *   npm install
 *   npm start
 * Then open http://127.0.0.1:3000
 */
'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const db = new Database(path.join(__dirname, 'organic.db'));
db.pragma('foreign_keys = ON');
const FLOW = ['Pending', 'Confirmed', 'Packed', 'Out for delivery', 'Delivered', 'Cancelled'];

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer');
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, name_bn TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL, price REAL NOT NULL CHECK (price > 0), unit TEXT NOT NULL DEFAULT 'kg',
  stock REAL NOT NULL DEFAULT 0 CHECK (stock >= 0), origin TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'Pending', subtotal REAL NOT NULL, delivery_fee REAL NOT NULL,
  total REAL NOT NULL, payment TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL,
  address TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id), name TEXT NOT NULL, unit TEXT NOT NULL,
  price REAL NOT NULL, qty REAL NOT NULL);
`);

function seed() {
  if (db.prepare('SELECT COUNT(*) AS n FROM products').get().n === 0) {
    const ins = db.prepare(
      'INSERT INTO products (name, name_bn, category, price, unit, stock, origin) VALUES (?,?,?,?,?,?,?)');
    const items = JSON.parse(fs.readFileSync(path.join(ROOT, 'database', 'products_seed.json'), 'utf8'));
    db.transaction(() => items.forEach(p =>
      ins.run(p.name, p.name_bn, p.category, p.price, p.unit, p.stock, p.origin)))();
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
    const ins = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)');
    ins.run('Admin', 'admin@organicfood.demo', bcrypt.hashSync('admin123', 10), 'admin');
    ins.run('Nusrat Jahan', 'customer@organicfood.demo', bcrypt.hashSync('customer123', 10), 'customer');
  }
}
seed();

const app = express();
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' },
}));

const fail = (res, code, message) => res.status(code).json({ error: message });
const needLogin = (req, res, next) => (req.session.user ? next() : fail(res, 401, 'Login required'));
const needAdmin = (req, res, next) =>
  needLogin(req, res, () => (req.session.user.role === 'admin' ? next() : fail(res, 403, 'Admin only')));
const deliveryFee = s => (s <= 0 || s >= 1000 ? 0 : 60);

app.get('/', (_req, res) => res.sendFile(path.join(ROOT, 'demo.html')));

// ---------- auth ----------
app.post('/api/register', (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const pw = String(req.body.password || '');
  if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || pw.length < 6)
    return fail(res, 422, 'Enter a name, a valid email and a password of 6+ characters');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return fail(res, 409, 'Email already registered');
  const info = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?,?,?)')
    .run(name, email, bcrypt.hashSync(pw, 10));
  req.session.user = { id: Number(info.lastInsertRowid), name, email, role: 'customer' };
  res.status(201).json(req.session.user);
});

app.post('/api/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.password_hash))
    return fail(res, 401, 'Email or password is incorrect');
  req.session.user = { id: u.id, name: u.name, email: u.email, role: u.role };
  res.json(req.session.user);
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', (req, res) => res.json(req.session.user || {}));

// ---------- shop ----------
app.get('/api/products', (_req, res) => res.json(db.prepare('SELECT * FROM products ORDER BY id').all()));

app.post('/api/orders', needLogin, (req, res) => {
  const b = req.body;
  const name = String(b.name || '').trim();
  const phone = String(b.phone || '').replace(/[\s-]/g, '');
  const address = String(b.address || '').trim();
  const payment = ['Cash on delivery', 'bKash on delivery'].includes(b.payment) ? b.payment : 'Cash on delivery';
  const items = Array.isArray(b.items) ? b.items : [];
  if (name.length < 2 || !/^01[3-9]\d{8}$/.test(phone) || address.length < 8)
    return fail(res, 422, 'Check name, mobile number (01XXXXXXXXX) and address');
  if (!items.length) return fail(res, 422, 'Cart is empty');

  const place = db.transaction(() => {
    const lines = [];
    let subtotal = 0;
    for (const it of items) {
      const qty = Number(it.qty);
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(it.id);
      if (!p || !(qty > 0) || p.stock < qty)
        throw Object.assign(new Error(`${p ? p.name : 'An item'} is not available in that quantity`), { code: 409 });
      subtotal += p.price * qty;
      lines.push([p, qty]);
    }
    const fee = deliveryFee(subtotal);
    const info = db.prepare(
      `INSERT INTO orders (user_id, subtotal, delivery_fee, total, payment, name, phone, address, note)
       VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(req.session.user.id, subtotal, fee, subtotal + fee, payment, name, phone, address, String(b.note || '').trim());
    const id = Number(info.lastInsertRowid);
    for (const [p, qty] of lines) {
      db.prepare('INSERT INTO order_items (order_id, product_id, name, unit, price, qty) VALUES (?,?,?,?,?,?)')
        .run(id, p.id, p.name, p.unit, p.price, qty);
      db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(qty, p.id);
    }
    return { id, total: subtotal + fee };
  });

  try {
    res.status(201).json(place());
  } catch (e) {
    fail(res, e.code === 409 ? 409 : 500, e.code === 409 ? e.message : 'Server error');
  }
});

app.get('/api/orders', needLogin, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC, id DESC')
    .all(req.session.user.id);
  const itemStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  orders.forEach(o => { o.items = itemStmt.all(o.id); });
  res.json(orders);
});

const restock = (orderId, sign) => {
  for (const it of db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId))
    db.prepare('UPDATE products SET stock = MAX(0, stock + ?) WHERE id = ?').run(sign * it.qty, it.product_id);
};

app.post('/api/orders/:id/cancel', needLogin, (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.session.user.id);
  if (!o || o.status !== 'Pending') return fail(res, 409, 'Only your pending orders can be cancelled');
  db.transaction(() => {
    db.prepare("UPDATE orders SET status = 'Cancelled' WHERE id = ?").run(o.id);
    restock(o.id, +1);
  })();
  res.json({ ok: true });
});

// ---------- admin ----------
app.get('/api/admin/orders', needAdmin, (_req, res) => res.json(db.prepare(
  `SELECT o.*, (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS item_count
   FROM orders o ORDER BY created_at DESC, id DESC`).all()));

app.patch('/api/admin/orders/:id', needAdmin, (req, res) => {
  const { status } = req.body;
  if (!FLOW.includes(status)) return fail(res, 422, 'Unknown status');
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!o) return fail(res, 404, 'Order not found');
  if (o.status !== status) {
    db.transaction(() => {
      if (status === 'Cancelled') restock(o.id, +1);
      else if (o.status === 'Cancelled') restock(o.id, -1);
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, o.id);
    })();
  }
  res.json({ ok: true });
});

function productValues(b) {
  const v = [String(b.name || '').trim(), String(b.name_bn || '').trim(), String(b.category || '').trim(),
    Number(b.price), String(b.unit || 'kg').trim(), Number(b.stock), String(b.origin || '').trim()];
  return v[0].length < 2 || !(v[3] > 0) || !(v[5] >= 0) || !v[2] ? null : v;
}

app.post('/api/admin/products', needAdmin, (req, res) => {
  const v = productValues(req.body);
  if (!v) return fail(res, 422, 'Invalid product data');
  const info = db.prepare(
    'INSERT INTO products (name, name_bn, category, price, unit, stock, origin) VALUES (?,?,?,?,?,?,?)').run(...v);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

app.put('/api/admin/products/:id', needAdmin, (req, res) => {
  const v = productValues(req.body);
  if (!v) return fail(res, 422, 'Invalid product data');
  db.prepare('UPDATE products SET name=?, name_bn=?, category=?, price=?, unit=?, stock=?, origin=? WHERE id=?')
    .run(...v, req.params.id);
  res.json({ id: Number(req.params.id) });
});

app.delete('/api/admin/products/:id', needAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    fail(res, 409, 'Product is used by existing orders and cannot be deleted');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Organic Food System running on http://127.0.0.1:${PORT}`));
