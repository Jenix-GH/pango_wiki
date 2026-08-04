-- 访问及业务事件明细表。
-- 在现有数据库上执行一次；重复执行前请先确认表不存在。

CREATE TABLE `dto_analytics_event` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '事件ID',
  `event_name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '事件名称',
  `page_path` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '页面路径',
  `client_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'WEB/MINIPROGRAM',
  `visitor_id` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '去重访客标识',
  `userinfo_id` bigint NOT NULL COMMENT '关联用户或访客ID',
  `session_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '问答会话ID',
  `document_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '文档ID',
  `ip_address` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '访问IP',
  `user_agent` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '客户端User-Agent',
  `event_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '事件时间',
  PRIMARY KEY (`id`),
  KEY `idx_analytics_event_time` (`event_name`,`event_time`),
  KEY `idx_analytics_visitor_time` (`visitor_id`,`event_time`),
  KEY `idx_analytics_client_time` (`client_type`,`event_time`),
  KEY `idx_analytics_document_time` (`document_id`,`event_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='访问及业务事件明细';
