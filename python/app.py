"""
Online Organic Food System - Python (Flask + SQLite) backend.

Run:
    pip install -r requirements.txt
    python app.py
Then open http://127.0.0.1:5000
"""
import json
import os
import re
import sqlite3

from flask import Flask, g, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE, ".."))
DB_PATH = os.path.join(BASE, "organic.db")
SEED_PATH = os.path.join(ROOT, "database", "products_seed.json")
FLOW = ["Pending", "Confirmed", "Packed", "Out for delivery", "Delivered", "Cancelled"]

app = Flask(__name__, static_folder=None)
app.secret_key = os.environ.get("SECRET_KEY", "change-this-secret-in-production")
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer'
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, name_bn TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL, price REAL NOT NULL CHECK (price > 0),
  unit TEXT NOT NULL DEFAULT 'kg', stock REAL NOT NULL DEFAULT 0 CHECK (stock >= 0),
  origin TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'Pending',
  subtotal REAL NOT NULL, delivery_fee REAL NOT NULL, total REAL NOT NULL,
  payment TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL,
  address TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  name TEXT NOT NULL, unit TEXT NOT NULL, price REAL NOT NULL, qty REAL NOT NULL
);
"""


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.executescript(SCHEMA)
    if db.execute("SELECT COUNT(*) FROM products").fetchone()[0] == 0:
        with open(SEED_PATH, encoding="utf-8") as fh:
            for p in json.load(fh):
                db.execute(
                    "INSERT INTO products (name, name_bn, category, price, unit, stock, origin) "
                    "VALUES (?,?,?,?,?,?,?)",
                    (p["name"], p["name_bn"], p["category"], p["price"], p["unit"], p["stock"], p["origin"]),
                )
    if db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
        for name, email, pw, role in [
            ("Admin", "admin@organicfood.demo", "admin123", "admin"),
            ("Nusrat Jahan", "customer@organicfood.demo", "customer123", "customer"),
        ]:
            db.execute(
                "INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)",
                (name, email, generate_password_hash(pw), role),
            )
    db.commit()
    db.close()


def err(message, code):
    return jsonify({"error": message}), code


def current_user():
    return session.get("user")


def delivery_fee(subtotal):
    return 0 if subtotal <= 0 or subtotal >= 1000 else 60


def login_required(fn):
    from functools import wraps

    @wraps(fn)
    def wrapper(*a, **kw):
        if not current_user():
            return err("Login required", 401)
        return fn(*a, **kw)

    return wrapper


def admin_required(fn):
    from functools import wraps

    @wraps(fn)
    @login_required
    def wrapper(*a, **kw):
        if current_user()["role"] != "admin":
            return err("Admin only", 403)
        return fn(*a, **kw)

    return wrapper


# ---------- pages ----------
@app.get("/")
def index():
    return send_from_directory(ROOT, "index.html")


# ---------- auth ----------
@app.post("/api/register")
def register():
    d = request.get_json(silent=True) or {}
    name = str(d.get("name", "")).strip()
    email = str(d.get("email", "")).strip().lower()
    pw = str(d.get("password", ""))
    if len(name) < 2 or not re.match(r"^\S+@\S+\.\S+$", email) or len(pw) < 6:
        return err("Enter a name, a valid email and a password of 6+ characters", 422)
    db = get_db()
    if db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        return err("Email already registered", 409)
    cur = db.execute(
        "INSERT INTO users (name, email, password_hash) VALUES (?,?,?)",
        (name, email, generate_password_hash(pw)),
    )
    db.commit()
    session["user"] = {"id": cur.lastrowid, "name": name, "email": email, "role": "customer"}
    return jsonify(session["user"]), 201


@app.post("/api/login")
def login():
    d = request.get_json(silent=True) or {}
    email = str(d.get("email", "")).strip().lower()
    u = get_db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not u or not check_password_hash(u["password_hash"], str(d.get("password", ""))):
        return err("Email or password is incorrect", 401)
    session["user"] = {"id": u["id"], "name": u["name"], "email": u["email"], "role": u["role"]}
    return jsonify(session["user"])


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/me")
def me():
    return jsonify(current_user() or {})


# ---------- shop ----------
@app.get("/api/products")
def products():
    rows = get_db().execute("SELECT * FROM products ORDER BY id").fetchall()
    return jsonify([dict(r) for r in rows])


@app.post("/api/orders")
@login_required
def create_order():
    d = request.get_json(silent=True) or {}
    name = str(d.get("name", "")).strip()
    phone = re.sub(r"[\s-]", "", str(d.get("phone", "")))
    address = str(d.get("address", "")).strip()
    payment = d.get("payment") if d.get("payment") in ("Cash on delivery", "bKash on delivery") else "Cash on delivery"
    items = d.get("items") or []
    if len(name) < 2 or not re.match(r"^01[3-9]\d{8}$", phone) or len(address) < 8:
        return err("Check name, mobile number (01XXXXXXXXX) and address", 422)
    if not isinstance(items, list) or not items:
        return err("Cart is empty", 422)

    db = get_db()
    try:
        db.execute("BEGIN IMMEDIATE")
        lines, subtotal = [], 0.0
        for it in items:
            qty = float(it.get("qty", 0))
            p = db.execute("SELECT * FROM products WHERE id = ?", (it.get("id"),)).fetchone()
            if not p or qty <= 0 or p["stock"] < qty:
                db.rollback()
                return err(f"{p['name'] if p else 'An item'} is not available in that quantity", 409)
            subtotal += p["price"] * qty
            lines.append((p, qty))
        fee = delivery_fee(subtotal)
        cur = db.execute(
            "INSERT INTO orders (user_id, subtotal, delivery_fee, total, payment, name, phone, address, note) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (current_user()["id"], subtotal, fee, subtotal + fee, payment, name, phone, address,
             str(d.get("note", "")).strip()),
        )
        order_id = cur.lastrowid
        for p, qty in lines:
            db.execute(
                "INSERT INTO order_items (order_id, product_id, name, unit, price, qty) VALUES (?,?,?,?,?,?)",
                (order_id, p["id"], p["name"], p["unit"], p["price"], qty),
            )
            db.execute("UPDATE products SET stock = stock - ? WHERE id = ?", (qty, p["id"]))
        db.commit()
        return jsonify({"id": order_id, "total": subtotal + fee}), 201
    except Exception:
        db.rollback()
        return err("Server error", 500)


@app.get("/api/orders")
@login_required
def my_orders():
    db = get_db()
    orders = [dict(r) for r in db.execute(
        "SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC, id DESC",
        (current_user()["id"],)).fetchall()]
    for o in orders:
        o["items"] = [dict(r) for r in db.execute(
            "SELECT * FROM order_items WHERE order_id = ?", (o["id"],)).fetchall()]
    return jsonify(orders)


def _restock(db, order_id, sign):
    for it in db.execute("SELECT * FROM order_items WHERE order_id = ?", (order_id,)).fetchall():
        db.execute("UPDATE products SET stock = MAX(0, stock + ?) WHERE id = ?",
                   (sign * it["qty"], it["product_id"]))


@app.post("/api/orders/<int:order_id>/cancel")
@login_required
def cancel_order(order_id):
    db = get_db()
    o = db.execute("SELECT * FROM orders WHERE id = ? AND user_id = ?",
                   (order_id, current_user()["id"])).fetchone()
    if not o or o["status"] != "Pending":
        return err("Only your pending orders can be cancelled", 409)
    db.execute("UPDATE orders SET status = 'Cancelled' WHERE id = ?", (order_id,))
    _restock(db, order_id, +1)
    db.commit()
    return jsonify({"ok": True})


# ---------- admin ----------
@app.get("/api/admin/orders")
@admin_required
def admin_orders():
    rows = get_db().execute(
        "SELECT o.*, (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS item_count "
        "FROM orders o ORDER BY created_at DESC, id DESC").fetchall()
    return jsonify([dict(r) for r in rows])


@app.patch("/api/admin/orders/<int:order_id>")
@admin_required
def admin_status(order_id):
    status = (request.get_json(silent=True) or {}).get("status")
    if status not in FLOW:
        return err("Unknown status", 422)
    db = get_db()
    o = db.execute("SELECT status FROM orders WHERE id = ?", (order_id,)).fetchone()
    if not o:
        return err("Order not found", 404)
    if o["status"] != status:
        if status == "Cancelled":
            _restock(db, order_id, +1)
        elif o["status"] == "Cancelled":
            _restock(db, order_id, -1)
        db.execute("UPDATE orders SET status = ? WHERE id = ?", (status, order_id))
        db.commit()
    return jsonify({"ok": True})


@app.route("/api/admin/products", methods=["POST"])
@app.route("/api/admin/products/<int:pid>", methods=["PUT"])
@admin_required
def admin_product_save(pid=None):
    d = request.get_json(silent=True) or {}
    try:
        vals = (str(d.get("name", "")).strip(), str(d.get("name_bn", "")).strip(),
                str(d.get("category", "")).strip(), float(d.get("price", 0)),
                str(d.get("unit", "kg")).strip(), float(d.get("stock", -1)),
                str(d.get("origin", "")).strip())
    except (TypeError, ValueError):
        return err("Invalid product data", 422)
    if len(vals[0]) < 2 or vals[3] <= 0 or vals[5] < 0 or not vals[2]:
        return err("Invalid product data", 422)
    db = get_db()
    if pid:
        db.execute("UPDATE products SET name=?, name_bn=?, category=?, price=?, unit=?, stock=?, origin=? "
                   "WHERE id=?", (*vals, pid))
    else:
        pid = db.execute("INSERT INTO products (name, name_bn, category, price, unit, stock, origin) "
                         "VALUES (?,?,?,?,?,?,?)", vals).lastrowid
    db.commit()
    return jsonify({"id": pid})


@app.delete("/api/admin/products/<int:pid>")
@admin_required
def admin_product_delete(pid):
    db = get_db()
    try:
        db.execute("DELETE FROM products WHERE id = ?", (pid,))
        db.commit()
    except sqlite3.IntegrityError:
        return err("Product is used by existing orders and cannot be deleted", 409)
    return jsonify({"ok": True})


if __name__ == "__main__":
    init_db()
    app.run(debug=True, port=5000)
