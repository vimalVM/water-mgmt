-- ============================================================
--  Smart Water Management and Usage Analytics System
--  MySQL Database Schema
-- ============================================================

CREATE DATABASE IF NOT EXISTS water_mgmt;
USE water_mgmt;

-- ─── USERS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    user_id        INT AUTO_INCREMENT PRIMARY KEY,
    name           VARCHAR(100)  NOT NULL,
    email          VARCHAR(150)  NOT NULL UNIQUE,
    password       VARCHAR(255)  NOT NULL,
    green_limit    FLOAT         NOT NULL DEFAULT 100.0,   -- litres/day
    orange_limit   FLOAT         NOT NULL DEFAULT 200.0,   -- litres/day
    created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─── TAPS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS taps (
    tap_id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id        INT          NOT NULL,
    tap_name       VARCHAR(100) NOT NULL,
    location       VARCHAR(100) NOT NULL DEFAULT 'General',
    tap_status     ENUM('ON','OFF') NOT NULL DEFAULT 'OFF',
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- ─── TAP USAGE RUNNING (live running total for today) ────────
CREATE TABLE IF NOT EXISTS tap_usage_running (
    tap_id         INT   PRIMARY KEY,
    current_usage  FLOAT NOT NULL DEFAULT 0.0,
    last_update    DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (tap_id) REFERENCES taps(tap_id) ON DELETE CASCADE
);

-- ─── TAP USAGE TIMESERIES (every simulator tick) ─────────────
CREATE TABLE IF NOT EXISTS tap_usage_timeseries (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    tap_id         INT      NOT NULL,
    usage_liters   FLOAT    NOT NULL,
    recorded_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tap_id) REFERENCES taps(tap_id) ON DELETE CASCADE
);

-- ─── TAP DAILY ARCHIVE (archived at midnight) ────────────────
CREATE TABLE IF NOT EXISTS tap_daily_archive (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    tap_id         INT     NOT NULL,
    usage_liters   FLOAT   NOT NULL DEFAULT 0.0,
    archive_date   DATE    NOT NULL,
    UNIQUE KEY unique_tap_date (tap_id, archive_date),
    FOREIGN KEY (tap_id) REFERENCES taps(tap_id) ON DELETE CASCADE
);

-- ─── SYSTEM DAILY TOTALS (per user per day) ──────────────────
CREATE TABLE IF NOT EXISTS system_daily_totals (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    user_id        INT           NOT NULL,
    total_usage    FLOAT         NOT NULL DEFAULT 0.0,
    color_status   ENUM('green','orange','red') NOT NULL DEFAULT 'green',
    usage_date     DATE          NOT NULL,
    UNIQUE KEY unique_user_date (user_id, usage_date),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- ─── INDEXES ─────────────────────────────────────────────────
CREATE INDEX idx_timeseries_tap     ON tap_usage_timeseries (tap_id, recorded_at);
CREATE INDEX idx_archive_tap        ON tap_daily_archive    (tap_id, archive_date);
CREATE INDEX idx_daily_totals_user  ON system_daily_totals  (user_id, usage_date);
