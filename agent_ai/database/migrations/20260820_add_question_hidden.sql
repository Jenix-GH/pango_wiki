-- Persist history visibility without deleting question or answer content.
SET @hidden_column_exists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'dto_question'
    AND column_name = 'flag_hidden'
);

SET @hidden_column_sql = IF(
  @hidden_column_exists = 0,
  'ALTER TABLE `dto_question` ADD COLUMN `flag_hidden` TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''历史记录隐藏标志：0显示，1隐藏'' AFTER `flag_del`',
  'SELECT ''dto_question.flag_hidden already exists'''
);

PREPARE hidden_column_statement FROM @hidden_column_sql;
EXECUTE hidden_column_statement;
DEALLOCATE PREPARE hidden_column_statement;

SET @hidden_index_exists = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'dto_question'
    AND index_name = 'idx_question_user_hidden_date'
);

SET @hidden_index_sql = IF(
  @hidden_index_exists = 0,
  'CREATE INDEX `idx_question_user_hidden_date` ON `dto_question` (`userinfo_id`, `flag_del`, `flag_hidden`, `do_date`, `id`)',
  'SELECT ''idx_question_user_hidden_date already exists'''
);

PREPARE hidden_index_statement FROM @hidden_index_sql;
EXECUTE hidden_index_statement;
DEALLOCATE PREPARE hidden_index_statement;
