-- Online Organic Food System : MySQL schema + sample data
-- Usage:  mysql -u root -p < database/schema.sql
-- Then create the admin user with:  php php/install.php

CREATE DATABASE IF NOT EXISTS organic_food CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE organic_food;

DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('customer','admin') NOT NULL DEFAULT 'customer',
  phone         VARCHAR(20)  NOT NULL DEFAULT '',
  address       VARCHAR(255) NOT NULL DEFAULT '',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE products (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  name      VARCHAR(120) NOT NULL,
  name_bn   VARCHAR(120) NOT NULL DEFAULT '',
  category  VARCHAR(60)  NOT NULL,
  price     DECIMAL(10,2) NOT NULL CHECK (price > 0),
  unit      VARCHAR(20)  NOT NULL DEFAULT 'kg',
  stock     DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (stock >= 0),
  origin    VARCHAR(80)  NOT NULL DEFAULT '',
  INDEX idx_category (category)
) ENGINE=InnoDB;

CREATE TABLE orders (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  status     ENUM('Pending','Confirmed','Packed','Out for delivery','Delivered','Cancelled') NOT NULL DEFAULT 'Pending',
  subtotal   DECIMAL(10,2) NOT NULL,
  delivery_fee DECIMAL(10,2) NOT NULL,
  total      DECIMAL(10,2) NOT NULL,
  payment    VARCHAR(40)  NOT NULL,
  name       VARCHAR(100) NOT NULL,
  phone      VARCHAR(20)  NOT NULL,
  address    VARCHAR(255) NOT NULL,
  note       VARCHAR(255) NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE order_items (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  order_id   INT NOT NULL,
  product_id INT NOT NULL,
  name       VARCHAR(120) NOT NULL,
  unit       VARCHAR(20)  NOT NULL,
  price      DECIMAL(10,2) NOT NULL,
  qty        DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (order_id)   REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB;

INSERT INTO products (name, name_bn, category, price, unit, stock, origin) VALUES
('Tomato','টমেটো','Vegetables',90,'kg',60,'Jashore'),
('Spinach','পালং শাক','Vegetables',60,'kg',35,'Gazipur'),
('Pumpkin','মিষ্টি কুমড়া','Vegetables',55,'kg',80,'Bogura'),
('Eggplant','বেগুন','Vegetables',80,'kg',45,'Jashore'),
('Banana','কলা','Fruits',120,'dozen',40,'Narsingdi'),
('Guava','পেয়ারা','Fruits',130,'kg',28,'Barishal'),
('Papaya','পেঁপে','Fruits',70,'kg',33,'Rajshahi'),
('Chinigura rice','চিনিগুঁড়া চাল','Grains & pulses',150,'kg',200,'Dinajpur'),
('Red lentil','মসুর ডাল','Grains & pulses',140,'kg',90,'Pabna'),
('Free-range eggs','দেশি ডিম','Dairy & eggs',180,'dozen',24,'Savar'),
('Fresh cow milk','গরুর দুধ','Dairy & eggs',110,'litre',30,'Sirajganj'),
('Ghee','ঘি','Dairy & eggs',1100,'kg',12,'Sirajganj'),
('Cold-pressed mustard oil','সরিষার তেল','Honey & oils',380,'litre',40,'Manikganj'),
('Sundarbans honey','সুন্দরবনের মধু','Honey & oils',1200,'kg',8,'Khulna'),
('Date molasses','খেজুরের গুড়','Honey & oils',320,'kg',25,'Jashore');
