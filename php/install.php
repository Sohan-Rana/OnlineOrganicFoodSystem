<?php
// Run once from the command line after importing database/schema.sql:
//   php php/install.php
// Creates the demo admin and customer accounts with hashed passwords.

$cfg = require __DIR__ . '/config.php';
$pdo = new PDO(
    "mysql:host={$cfg['host']};dbname={$cfg['db']};charset={$cfg['charset']}",
    $cfg['user'],
    $cfg['pass'],
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
);

$users = [
    ['Admin',        'admin@organicfood.demo',    'admin123',    'admin'],
    ['Nusrat Jahan', 'customer@organicfood.demo', 'customer123', 'customer'],
];

$stmt = $pdo->prepare(
    'INSERT IGNORE INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
);
foreach ($users as [$name, $email, $pass, $role]) {
    $stmt->execute([$name, $email, password_hash($pass, PASSWORD_DEFAULT), $role]);
    echo "Created $role: $email / $pass\n";
}
echo "Done.\n";
