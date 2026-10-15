-- Additive CC settings and immutable recipient history. Existing applications are unchanged.
CREATE TABLE IF NOT EXISTS dto_license_cc (
  target_kind VARCHAR(16) NOT NULL,
  target_id VARCHAR(36) NOT NULL,
  application_id BIGINT UNSIGNED NOT NULL,
  recipient VARCHAR(254) NOT NULL,
  cc_json TEXT NOT NULL,
  updated_by VARCHAR(100) NOT NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (target_kind, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dto_license_mail_recipients (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  mail_id CHAR(36) NOT NULL,
  recipient VARCHAR(254) NOT NULL,
  cc_json TEXT NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_license_mail_recipients (mail_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
