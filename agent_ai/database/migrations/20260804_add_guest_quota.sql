-- Move the 50-question guest limit from clients to the database/backend.
-- Safe to execute once on an existing MySQL database.

ALTER TABLE `dto_userinfo`
  ADD COLUMN `user_type` varchar(16) NOT NULL DEFAULT 'USER' COMMENT 'USER/GUEST' AFTER `job_name`,
  ADD COLUMN `quota_used` int unsigned NOT NULL DEFAULT 0 COMMENT '访客已使用提问次数' AFTER `user_type`,
  ADD INDEX `idx_userinfo_type_quota` (`user_type`, `quota_used`);

-- Existing guest rows are identified by the format already used by ServiceUserinfo.
UPDATE `dto_userinfo`
SET `user_type` = 'GUEST'
WHERE `wx_code` LIKE 'guest:%';

-- Preserve usage accumulated before this migration. Deleted history still counts
-- because dto_answer records are not removed by the question-history soft delete.
UPDATE `dto_userinfo` u
LEFT JOIN (
  SELECT `userinfo_id`, COUNT(*) AS `answer_count`
  FROM `dto_answer`
  GROUP BY `userinfo_id`
) a ON a.`userinfo_id` = u.`id`
SET u.`quota_used` = LEAST(COALESCE(a.`answer_count`, 0), 50)
WHERE u.`user_type` = 'GUEST';
