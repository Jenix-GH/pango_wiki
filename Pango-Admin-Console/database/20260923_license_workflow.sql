-- Additive migration. Existing applications and status values are not rewritten.
CREATE TABLE IF NOT EXISTS dto_license_digest_batch (
  mail_id CHAR(36) NOT NULL PRIMARY KEY,
  payload MEDIUMTEXT NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dto_license_digest_item (
  mail_id CHAR(36) NOT NULL,
  application_id BIGINT UNSIGNED NOT NULL,
  application_snapshot TEXT NOT NULL,
  PRIMARY KEY (mail_id, application_id),
  KEY idx_license_digest_application (application_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dto_license_rejection (
  application_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  reason VARCHAR(2000) NOT NULL,
  recipient VARCHAR(254) NOT NULL,
  application_snapshot TEXT NOT NULL,
  requested_by VARCHAR(100) NOT NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'queued',
  detail VARCHAR(500) NOT NULL DEFAULT '',
  attempts INT NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_license_rejection_queue (state, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
