-- 回答关联图片持久化，用于 Web 和小程序恢复历史会话时展示模型配图。
-- 图片仅保存元数据和相对 URL，不保存 Base64 文件内容。

SET @schema_name = DATABASE();
SET @column_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'dto_answer'
    AND COLUMN_NAME = 'answer_media'
);

SET @ddl = IF(
  @column_exists = 0,
  'ALTER TABLE `dto_answer` ADD COLUMN `answer_media` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT ''回答关联图片，JSON数组'' AFTER `reference`',
  'SELECT ''dto_answer.answer_media already exists'''
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
