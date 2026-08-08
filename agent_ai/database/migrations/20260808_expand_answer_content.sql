-- Allow Java-side stream persistence to store complete model answers without
-- failing when Markdown content exceeds the legacy VARCHAR(5000) limit.
ALTER TABLE `dto_answer`
    MODIFY COLUMN `content` LONGTEXT
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT '回答正文';
