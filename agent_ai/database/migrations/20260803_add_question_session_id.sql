-- Existing databases: persist the client session id and accelerate session history queries.
ALTER TABLE `dto_question`
  ADD COLUMN `session_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '客户端会话ID' AFTER `question_type`,
  ADD INDEX `idx_question_user_session` (`userinfo_id`, `session_id`);

-- Existing rows remain NULL. Their original session relationship cannot be reconstructed,
-- so the application displays each legacy question as an independent session.
