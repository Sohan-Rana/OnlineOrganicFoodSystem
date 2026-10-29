# 🥦 Online Organic Food System

**Author:** Sohan Rana
**Languages:** HTML · CSS · JavaScript · PHP · Python · Node.js · SQL (MySQL / SQLite)

An online store for organic produce from small farms. Customers browse, order and track delivery; an admin manages products and order status.

The project ships in two parts:

- **`index.html`**: a standalone demo. Open it in a browser, no install needed. Everything is saved in localStorage.
- **Three interchangeable backends** that expose the same features through a JSON API: PHP + MySQL, Python (Flask) + SQLite, Node.js (Express) + SQLite.

## 📂 Folder Structure

```
OnlineOrganicFoodSystem/
├── index.html                # Standalone demo (HTML + CSS + JS, localStorage)
├── README.md
├── js/
│   └── api.js                # Fetch client for the Flask / Express API
├── database/
│   ├── schema.sql            # MySQL schema + sample products (used by PHP)
│   └── products_seed.json    # Sample products (used by Python and Node)
├── php/                      # PHP + MySQL backend
│   ├── config.php
│   ├── install.php           # Creates demo accounts
│   └── api.php               # JSON API  (api.php?action=...)
├── python/                   # Python backend
│   ├── app.py                # Flask + SQLite
│   └── requirements.txt
└── node/                     # Node.js backend
    ├── server.js             # Express + SQLite
    └── package.json
```

## 🔑 Demo Logins

| Role     | Email                        | Password      |
|----------|------------------------------|---------------|
| Customer | customer@organicfood.demo    | customer123   |
| Admin    | admin@organicfood.demo       | admin123      |

> Change these passwords before using any backend on a public server.

## 🚀 How to Run

### 1. Demo only (no install)
Open `index.html` in any modern browser.
Live demo: https://sohan-rana.github.io/OnlineOrganicFoodSystem/

### 2. PHP + MySQL
```bash
mysql -u root -p < database/schema.sql     # create database and sample data
# edit php/config.php if your MySQL user/password differ
php php/install.php                        # create demo accounts
php -S 127.0.0.1:8000                      # run from the project root
```
API: `http://127.0.0.1:8000/php/api.php?action=products`

### 3. Python (Flask + SQLite)
```bash
cd python
pip install -r requirements.txt
python app.py
```
Open `http://127.0.0.1:5000`. The SQLite file is created automatically.

### 4. Node.js (Express + SQLite)
```bash
cd node
npm install
npm start
```
Open `http://127.0.0.1:3000`. The SQLite file is created automatically.

The Flask and Express servers serve `index.html` at `/` and the JSON API under `/api/...`. `index.html` itself uses localStorage; use `js/api.js` to connect your own front-end to a backend.

## 🔌 API Overview

| Action                       | Flask / Express                                   | PHP (`api.php?action=`)                |
|------------------------------|---------------------------------------------------|----------------------------------------|
| List products                | `GET /api/products`                               | `products`                             |
| Register / login / logout    | `POST /api/register` · `/api/login` · `/api/logout` | `register` · `login` · `logout`      |
| Current user                 | `GET /api/me`                                     | `me`                                   |
| Place order                  | `POST /api/orders`                                | `order`                                |
| My orders                    | `GET /api/orders`                                 | `my_orders`                            |
| Cancel pending order         | `POST /api/orders/:id/cancel`                     | `cancel_order`                         |
| Admin: all orders            | `GET /api/admin/orders`                           | `admin_orders`                         |
| Admin: change status         | `PATCH /api/admin/orders/:id`                     | `admin_status`                         |
| Admin: save / delete product | `POST·PUT·DELETE /api/admin/products`             | `admin_product_save` · `admin_product_delete` |

Orders are priced on the server from the database (never from the browser). Stock is checked and reduced inside a transaction, and restored when an order is cancelled.

## 🛠 Features

- Registration and login with hashed passwords (backends)
- Browse, search and filter products (English, Bangla, farm district)
- Cart with stock limits; delivery ৳60, free over ৳1,000
- Checkout with Cash on delivery or bKash on delivery
- Order tracking: Pending → Confirmed → Packed → Out for delivery → Delivered
- Admin: dashboard, product add/edit/delete, order status updates
- Responsive layout with automatic dark mode

## 🔮 Future Improvements

- Product images and customer reviews
- Real payment gateway integration
- Email / SMS order notifications
- Front-end switch between localStorage mode and API mode

## 📜 License

For learning and portfolio purposes.
