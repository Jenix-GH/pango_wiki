-- Admin-only additive storage. No application rows or historical mail states are changed.
CREATE TABLE IF NOT EXISTS dto_license_mail_draft (
  target_kind VARCHAR(16) NOT NULL,
  target_id VARCHAR(36) NOT NULL,
  binding_hash CHAR(64) NOT NULL,
  revision CHAR(36) NOT NULL,
  content_json MEDIUMTEXT NOT NULL,
  updated_by VARCHAR(100) NOT NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (target_kind,target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dto_license_nightly_report (
  id CHAR(36) NOT NULL PRIMARY KEY,
  report_date VARCHAR(10) NOT NULL,
  mail_id CHAR(36) NULL,
  payload MEDIUMTEXT NOT NULL,
  summary_detail VARCHAR(500) NOT NULL DEFAULT '',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_license_report_date (created_at),
  KEY idx_license_report_mail (mail_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
