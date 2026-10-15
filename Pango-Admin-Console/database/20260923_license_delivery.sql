-- Run explicitly before enabling LICENSE_DELIVERY_ENABLED. All dates use Asia/Shanghai.
CREATE TABLE IF NOT EXISTS dto_license_file (
  id CHAR(36) NOT NULL PRIMARY KEY,
  batch_id CHAR(36) NOT NULL,
  original_name VARCHAR(200) NOT NULL,
  mac CHAR(12) NULL,
  sha256 CHAR(64) NOT NULL,
  byte_length INT UNSIGNED NOT NULL,
  content MEDIUMBLOB NOT NULL,
  application_id BIGINT UNSIGNED NULL,
  application_snapshot TEXT NULL,
  manual_selection TINYINT NOT NULL DEFAULT 0,
  state VARCHAR(24) NOT NULL,
  reason VARCHAR(500) NOT NULL DEFAULT '',
  uploaded_by VARCHAR(100) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  uploaded_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_license_file_queue (state, uploaded_at),
  KEY idx_license_file_application (application_id),
  KEY idx_license_file_mac (mac),
  KEY idx_license_file_hash (sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dto_license_mail (
  id CHAR(36) NOT NULL PRIMARY KEY,
  dedupe_key VARCHAR(100) NOT NULL UNIQUE,
  kind VARCHAR(20) NOT NULL,
  file_id CHAR(36) NULL,
  application_id BIGINT UNSIGNED NULL,
  recipient VARCHAR(254) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  message_id VARCHAR(150) NOT NULL,
  state VARCHAR(24) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  detail VARCHAR(500) NOT NULL DEFAULT '',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_license_mail_file (file_id),
  KEY idx_license_mail_application (application_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dto_license_delivery_audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  file_id CHAR(36) NULL,
  actor VARCHAR(100) NOT NULL,
  action VARCHAR(40) NOT NULL,
  note VARCHAR(500) NOT NULL DEFAULT '',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_license_audit_file (file_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
