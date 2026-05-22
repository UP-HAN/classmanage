-- Drop database if exists and recreate to ensure schema updates
DROP DATABASE IF EXISTS class_tool;
CREATE DATABASE class_tool DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE class_tool;

-- 1. 학생 상세 정보 테이블 (students)
CREATE TABLE IF NOT EXISTS students (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  number INT NOT NULL,
  gender VARCHAR(10) NOT NULL,
  lv INT DEFAULT 1,
  exp INT DEFAULT 0,
  calory INT DEFAULT 0,
  coupons INT DEFAULT 0,
  class_role VARCHAR(100) DEFAULT '',
  job_id VARCHAR(50) DEFAULT '',
  avatar_data_url MEDIUMTEXT DEFAULT NULL,
  avatar_custom MEDIUMTEXT DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. 사용자 계정 테이블 (users)
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  login_id VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  salt VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL, -- 'teacher', 'student'
  display_name VARCHAR(100) NOT NULL,
  pin_code VARCHAR(100) DEFAULT NULL,
  pin_must_change BOOLEAN DEFAULT TRUE,
  student_id VARCHAR(36) DEFAULT NULL,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. 쿠폰숍 상품 테이블 (coupons)
CREATE TABLE IF NOT EXISTS coupons (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  price_cal INT NOT NULL,
  total_stock INT NOT NULL,
  remaining_stock INT NOT NULL,
  `desc` TEXT DEFAULT NULL,
  is_group BOOLEAN DEFAULT FALSE,
  group_target_count INT DEFAULT NULL,
  merchant_student_id VARCHAR(36) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. 쿠폰 렌탈(대여) 내역 테이블 (rentals)
CREATE TABLE IF NOT EXISTS rentals (
  id VARCHAR(36) PRIMARY KEY,
  product_id VARCHAR(36) DEFAULT NULL,
  coupon_name VARCHAR(200) NOT NULL,
  student_id VARCHAR(36) NOT NULL,
  student_name VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL, -- 'held', 'use_requested', 'merchant_approved', 'resolved'
  rented_at BIGINT NOT NULL,
  use_requested_at BIGINT DEFAULT NULL,
  merchant_approved_at BIGINT DEFAULT NULL,
  resolved_at BIGINT DEFAULT NULL,
  FOREIGN KEY (product_id) REFERENCES coupons(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. 매점 상품 테이블 (canteen_products)
CREATE TABLE IF NOT EXISTS canteen_products (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  price_cal INT NOT NULL,
  total_stock INT NOT NULL,
  remaining_stock INT NOT NULL,
  `desc` TEXT DEFAULT NULL,
  merchant_student_id VARCHAR(36) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6. 쿠폰 상점 로그 테이블 (coupon_merchant_logs)
CREATE TABLE IF NOT EXISTS coupon_merchant_logs (
  id VARCHAR(36) PRIMARY KEY,
  occurred_at BIGINT NOT NULL,
  date_ymd VARCHAR(10) NOT NULL,
  product_id VARCHAR(36) DEFAULT NULL,
  coupon_name VARCHAR(200) NOT NULL,
  buyer_student_id VARCHAR(36) NOT NULL,
  price_cal INT NOT NULL,
  merchant_student_id VARCHAR(36) DEFAULT NULL,
  rental_id VARCHAR(36) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. 매점 로그 테이블 (canteen_merchant_logs)
CREATE TABLE IF NOT EXISTS canteen_merchant_logs (
  id VARCHAR(36) PRIMARY KEY,
  occurred_at BIGINT NOT NULL,
  date_ymd VARCHAR(10) NOT NULL,
  product_id VARCHAR(36) DEFAULT NULL,
  product_name VARCHAR(200) NOT NULL,
  buyer_student_id VARCHAR(36) NOT NULL,
  price_cal INT NOT NULL,
  merchant_student_id VARCHAR(36) DEFAULT NULL,
  status VARCHAR(50) NOT NULL -- 'pending', 'approved', 'rejected'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 8. 학생 활동 로그 테이블 (activity_logs)
CREATE TABLE IF NOT EXISTS activity_logs (
  id VARCHAR(36) PRIMARY KEY,
  student_id VARCHAR(36) NOT NULL,
  occurred_at BIGINT NOT NULL,
  summary VARCHAR(255) NOT NULL,
  exp_delta INT DEFAULT 0,
  calory_delta INT DEFAULT 0,
  bulk_job_id VARCHAR(36) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 9. 벌크 조정 로그 테이블 (bulk_adjustments)
CREATE TABLE IF NOT EXISTS bulk_adjustments (
  id VARCHAR(36) PRIMARY KEY,
  occurred_at BIGINT NOT NULL,
  `type` VARCHAR(50) NOT NULL,
  target_count INT NOT NULL,
  summary VARCHAR(255) NOT NULL,
  exp_delta INT DEFAULT 0,
  calory_delta INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 10. 공통 전역 설정/Config 테이블 (settings)
CREATE TABLE IF NOT EXISTS settings (
  `key` VARCHAR(100) PRIMARY KEY,
  `value` JSON NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
