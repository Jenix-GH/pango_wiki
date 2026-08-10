-- Add an editable processing-progress note for feedback management.
SET @progress_column_exists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'dto_feedback'
    AND column_name = 'processing_progress'
);

SET @progress_column_sql = IF(
  @progress_column_exists = 0,
  'ALTER TABLE `dto_feedback` ADD COLUMN `processing_progress` TEXT COLLATE utf8mb4_unicode_ci NULL COMMENT ''管理员填写的处理进展'' AFTER `status`',
  'SELECT ''dto_feedback.processing_progress already exists'''
);

PREPARE progress_column_statement FROM @progress_column_sql;
EXECUTE progress_column_statement;
DEALLOCATE PREPARE progress_column_statement;
