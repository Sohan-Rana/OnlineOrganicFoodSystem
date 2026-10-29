<?php
declare(strict_types=1);

/**
 * Online Organic Food System - PHP + MySQL JSON API
 * Usage: api.php?action=<name>   (POST bodies are JSON)
 */

session_start();
header('Content-Type: application/json; charset=utf-8');

const FLOW = ['Pending', 'Confirmed', 'Packed', 'Out for delivery', 'Delivered', 'Cancelled'];

function out($data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function body(): array
{
    $json = json_decode(file_get_contents('php://input') ?: '', true);
    return is_array($json) ? $json : [];
}

function current_user(): ?array
{
    return $_SESSION['user'] ?? null;
}

function need_login(): array
{
    $u = current_user();
    if (!$u) {
        out(['error' => 'Login required'], 401);
    }
    return $u;
}

function need_admin(): array
{
    $u = need_login();
    if ($u['role'] !== 'admin') {
        out(['error' => 'Admin only'], 403);
    }
    return $u;
}

function delivery_fee(float $subtotal): float
{
    return ($subtotal <= 0 || $subtotal >= 1000) ? 0.0 : 60.0;
}

$cfg = require __DIR__ . '/config.php';
try {
    $pdo = new PDO(
        "mysql:host={$cfg['host']};dbname={$cfg['db']};charset={$cfg['charset']}",
        $cfg['user'],
        $cfg['pass'],
        [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]
    );
} catch (PDOException $e) {
    out(['error' => 'Database connection failed'], 500);
}

$action = $_GET['action'] ?? '';
$in = body();

try {
    switch ($action) {
        case 'products':
            out($pdo->query('SELECT * FROM products ORDER BY id')->fetchAll());

        case 'register':
            $name  = trim((string)($in['name'] ?? ''));
            $email = strtolower(trim((string)($in['email'] ?? '')));
            $pass  = (string)($in['password'] ?? '');
            if (strlen($name) < 2 || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($pass) < 6) {
                out(['error' => 'Enter a name, a valid email and a password of 6+ characters'], 422);
            }
            $exists = $pdo->prepare('SELECT id FROM users WHERE email = ?');
            $exists->execute([$email]);
            if ($exists->fetch()) {
                out(['error' => 'Email already registered'], 409);
            }
            $pdo->prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
                ->execute([$name, $email, password_hash($pass, PASSWORD_DEFAULT)]);
            $_SESSION['user'] = [
                'id' => (int)$pdo->lastInsertId(), 'name' => $name, 'email' => $email, 'role' => 'customer',
            ];
            out($_SESSION['user'], 201);

        case 'login':
            $email = strtolower(trim((string)($in['email'] ?? '')));
            $stmt = $pdo->prepare('SELECT * FROM users WHERE email = ?');
            $stmt->execute([$email]);
            $u = $stmt->fetch();
            if (!$u || !password_verify((string)($in['password'] ?? ''), $u['password_hash'])) {
                out(['error' => 'Email or password is incorrect'], 401);
            }
            session_regenerate_id(true);
            $_SESSION['user'] = [
                'id' => (int)$u['id'], 'name' => $u['name'], 'email' => $u['email'], 'role' => $u['role'],
            ];
            out($_SESSION['user']);

        case 'logout':
            $_SESSION = [];
            session_destroy();
            out(['ok' => true]);

        case 'me':
            out(current_user() ?? new stdClass());

        case 'order':
            $user = need_login();
            $name    = trim((string)($in['name'] ?? ''));
            $phone   = preg_replace('/[\s-]/', '', (string)($in['phone'] ?? ''));
            $address = trim((string)($in['address'] ?? ''));
            $payment = in_array($in['payment'] ?? '', ['Cash on delivery', 'bKash on delivery'], true)
                ? $in['payment'] : 'Cash on delivery';
            $items = $in['items'] ?? [];
            if (strlen($name) < 2 || !preg_match('/^01[3-9]\d{8}$/', $phone) || strlen($address) < 8) {
                out(['error' => 'Check name, mobile number (01XXXXXXXXX) and address'], 422);
            }
            if (!is_array($items) || !$items) {
                out(['error' => 'Cart is empty'], 422);
            }

            $pdo->beginTransaction();
            try {
                $lines = [];
                $subtotal = 0.0;
                $get = $pdo->prepare('SELECT * FROM products WHERE id = ? FOR UPDATE');
                foreach ($items as $it) {
                    $qty = (float)($it['qty'] ?? 0);
                    $get->execute([(int)($it['id'] ?? 0)]);
                    $p = $get->fetch();
                    if (!$p || $qty <= 0 || (float)$p['stock'] < $qty) {
                        $pdo->rollBack();
                        out(['error' => ($p['name'] ?? 'An item') . ' is not available in that quantity'], 409);
                    }
                    $subtotal += (float)$p['price'] * $qty;
                    $lines[] = [$p, $qty];
                }
                $fee = delivery_fee($subtotal);
                $pdo->prepare(
                    'INSERT INTO orders (user_id, subtotal, delivery_fee, total, payment, name, phone, address, note)
                     VALUES (?,?,?,?,?,?,?,?,?)'
                )->execute([
                    $user['id'], $subtotal, $fee, $subtotal + $fee, $payment,
                    $name, $phone, $address, trim((string)($in['note'] ?? '')),
                ]);
                $orderId = (int)$pdo->lastInsertId();
                $addItem = $pdo->prepare(
                    'INSERT INTO order_items (order_id, product_id, name, unit, price, qty) VALUES (?,?,?,?,?,?)'
                );
                $dec = $pdo->prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
                foreach ($lines as [$p, $qty]) {
                    $addItem->execute([$orderId, $p['id'], $p['name'], $p['unit'], $p['price'], $qty]);
                    $dec->execute([$qty, $p['id']]);
                }
                $pdo->commit();
                out(['id' => $orderId, 'total' => $subtotal + $fee], 201);
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                throw $e;
            }

        case 'my_orders':
            $user = need_login();
            $stmt = $pdo->prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC, id DESC');
            $stmt->execute([$user['id']]);
            $orders = $stmt->fetchAll();
            $itemStmt = $pdo->prepare('SELECT * FROM order_items WHERE order_id = ?');
            foreach ($orders as &$o) {
                $itemStmt->execute([$o['id']]);
                $o['items'] = $itemStmt->fetchAll();
            }
            out($orders);

        case 'cancel_order':
            $user = need_login();
            $id = (int)($in['id'] ?? 0);
            $pdo->beginTransaction();
            $stmt = $pdo->prepare('SELECT * FROM orders WHERE id = ? AND user_id = ? FOR UPDATE');
            $stmt->execute([$id, $user['id']]);
            $o = $stmt->fetch();
            if (!$o || $o['status'] !== 'Pending') {
                $pdo->rollBack();
                out(['error' => 'Only your pending orders can be cancelled'], 409);
            }
            $pdo->prepare("UPDATE orders SET status='Cancelled' WHERE id = ?")->execute([$id]);
            $pdo->prepare(
                'UPDATE products p JOIN order_items i ON i.product_id = p.id
                 SET p.stock = p.stock + i.qty WHERE i.order_id = ?'
            )->execute([$id]);
            $pdo->commit();
            out(['ok' => true]);

        // ---------- admin ----------
        case 'admin_orders':
            need_admin();
            out($pdo->query(
                'SELECT o.*, (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS item_count
                 FROM orders o ORDER BY created_at DESC, id DESC'
            )->fetchAll());

        case 'admin_status':
            need_admin();
            $id = (int)($in['id'] ?? 0);
            $status = (string)($in['status'] ?? '');
            if (!in_array($status, FLOW, true)) {
                out(['error' => 'Unknown status'], 422);
            }
            $pdo->beginTransaction();
            $stmt = $pdo->prepare('SELECT status FROM orders WHERE id = ? FOR UPDATE');
            $stmt->execute([$id]);
            $old = $stmt->fetchColumn();
            if ($old === false) {
                $pdo->rollBack();
                out(['error' => 'Order not found'], 404);
            }
            if ($old !== $status) {
                $sign = null;
                if ($status === 'Cancelled') { $sign = '+'; }
                elseif ($old === 'Cancelled') { $sign = '-'; }
                if ($sign !== null) {
                    $pdo->prepare(
                        "UPDATE products p JOIN order_items i ON i.product_id = p.id
                         SET p.stock = GREATEST(0, p.stock $sign i.qty) WHERE i.order_id = ?"
                    )->execute([$id]);
                }
                $pdo->prepare('UPDATE orders SET status = ? WHERE id = ?')->execute([$status, $id]);
            }
            $pdo->commit();
            out(['ok' => true]);

        case 'admin_product_save':
            need_admin();
            $id = (int)($in['id'] ?? 0);
            $f = [
                trim((string)($in['name'] ?? '')),
                trim((string)($in['name_bn'] ?? '')),
                trim((string)($in['category'] ?? '')),
                (float)($in['price'] ?? 0),
                trim((string)($in['unit'] ?? 'kg')),
                (float)($in['stock'] ?? -1),
                trim((string)($in['origin'] ?? '')),
            ];
            if (strlen($f[0]) < 2 || $f[3] <= 0 || $f[5] < 0 || $f[2] === '') {
                out(['error' => 'Invalid product data'], 422);
            }
            if ($id) {
                $pdo->prepare(
                    'UPDATE products SET name=?, name_bn=?, category=?, price=?, unit=?, stock=?, origin=? WHERE id=?'
                )->execute([...$f, $id]);
            } else {
                $pdo->prepare(
                    'INSERT INTO products (name, name_bn, category, price, unit, stock, origin) VALUES (?,?,?,?,?,?,?)'
                )->execute($f);
                $id = (int)$pdo->lastInsertId();
            }
            out(['id' => $id]);

        case 'admin_product_delete':
            need_admin();
            try {
                $pdo->prepare('DELETE FROM products WHERE id = ?')->execute([(int)($in['id'] ?? 0)]);
            } catch (PDOException $e) {
                out(['error' => 'Product is used by existing orders and cannot be deleted'], 409);
            }
            out(['ok' => true]);

        default:
            out(['error' => 'Unknown action'], 404);
    }
} catch (Throwable $e) {
    out(['error' => 'Server error'], 500);
}
