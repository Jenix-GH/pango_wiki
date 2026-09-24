CREATE TABLE IF NOT EXISTS dto_license_status_change (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  application_id BIGINT UNSIGNED NOT NULL,
  previous_status TINYINT NOT NULL,
  next_status TINYINT NOT NULL,
  actor VARCHAR(100) NOT NULL,
  note VARCHAR(500) NOT NULL DEFAULT '',
  rejection_snapshot MEDIUMTEXT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY idx_license_status_history (application_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
