-- 保存用户随问题上传的图片，使 Web/小程序重新打开历史会话时可以恢复显示。
-- 当前保存的是前端发给模型的图片 JSON（包含 MIME 类型、文件名和 Base64 数据）。
SET @schema_name = DATABASE();
SET @column_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'dto_question'
    AND COLUMN_NAME = 'question_images'
);

SET @ddl = IF(
  @column_exists = 0,
  'ALTER TABLE `dto_question` ADD COLUMN `question_images` LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT ''用户问题图片，JSON数组'' AFTER `question`',
  'SELECT ''dto_question.question_images already exists'''
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
