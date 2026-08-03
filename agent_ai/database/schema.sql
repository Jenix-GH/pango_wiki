-- agent_db complete schema initialization
-- Execute this script only against a new, empty MySQL database.

SET NAMES utf8mb4;

CREATE TABLE `dto_answer` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userinfo_id` int DEFAULT '0' COMMENT '用户ID',
  `question_id` int DEFAULT '0' COMMENT '问题',
  `think` varchar(5000) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '思考',
  `content` varchar(5000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '正文',
  `question_end` datetime DEFAULT NULL COMMENT '提问时间',
  `dotime` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '回答时间',
  `uptime` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `flag_evaluate` int DEFAULT '0',
  `answer_time` varchar(25) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reference` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `dto_company` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '标题',
  `phone` varchar(25) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '电话',
  `fax` varchar(25) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '传真',
  `code` varchar(25) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '邮编',
  `mail` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '邮箱',
  `address` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '地址',
  `dotime` datetime DEFAULT CURRENT_TIMESTAMP,
  `uptime` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `dto_feedback` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '反馈ID',
  `userinfo_id` bigint DEFAULT NULL COMMENT '用户ID，访客反馈可为空',
  `session_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '客户端会话ID',
  `platform` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '来源：web/miniprogram',
  `feedback_type` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '反馈类型',
  `detail` text COLLATE utf8mb4_unicode_ci COMMENT '用户补充说明',
  `question_content` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用户问题快照',
  `answer_content` longtext COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'AI回答快照',
  `contact_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '联系人姓名',
  `company_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '公司名称',
  `email` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '电子邮箱',
  `phone` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '联系电话',
  `status` tinyint NOT NULL DEFAULT '0' COMMENT '处理状态：0待处理，1处理中，2已处理，3已关闭',
  `dotime` datetime NOT NULL COMMENT '创建时间',
  `uptime` datetime NOT NULL COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_feedback_status_dotime` (`status`,`dotime`),
  KEY `idx_feedback_userinfo_id` (`userinfo_id`),
  KEY `idx_feedback_session_id` (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI回答问题反馈';

CREATE TABLE `dto_license_application` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '申请ID',
  `userinfo_id` bigint DEFAULT NULL COMMENT '关联用户ID，访客申请可为空',
  `operating_system` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作系统：Windows/Linux',
  `software_version` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '软件版本号',
  `license_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '授权类型：STANDALONE/SERVER',
  `duration_years` tinyint unsigned NOT NULL COMMENT '使用时长：1/2/3年',
  `mac_address` char(17) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '以-分隔的MAC地址',
  `applicant_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '申请人',
  `company_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '公司名称',
  `email` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '电子邮箱',
  `phone` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '联系电话',
  `address` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '地址',
  `status` tinyint NOT NULL DEFAULT '0' COMMENT '状态：0待处理，1处理中，2已通过，3已拒绝',
  `dotime` datetime NOT NULL COMMENT '创建时间',
  `uptime` datetime NOT NULL COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_license_status_dotime` (`status`,`dotime`),
  KEY `idx_license_userinfo_id` (`userinfo_id`),
  KEY `idx_license_mac_address` (`mac_address`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='License申请记录';

CREATE TABLE `dto_question` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userinfo_id` int DEFAULT NULL,
  `question` varchar(5000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `question_type` varchar(25) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `session_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '客户端会话ID',
  `do_date` varchar(25) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `dotime` datetime DEFAULT CURRENT_TIMESTAMP,
  `uptime` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  `flag_del` int DEFAULT '0',
  `internet_enable` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_question_user_session` (`userinfo_id`,`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `dto_set` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userinfo_id` int DEFAULT '0' COMMENT '用户信息ID',
  `data_use_flag` int DEFAULT '1' COMMENT '数据收集使用标识',
  `service_protocol` varchar(5000) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '服务协议',
  `about` varchar(5000) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关于公司介绍',
  `dotime` datetime DEFAULT CURRENT_TIMESTAMP,
  `uptime` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `dto_userinfo` (
  `id` int NOT NULL AUTO_INCREMENT,
  `wx_code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '微信号',
  `nick_name` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '昵称',
  `phone_number` varchar(25) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '手机号',
  `password_hash` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'BCrypt password hash',
  `mail_address` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '邮箱地址',
  `company_name` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '公司名',
  `job_name` varchar(25) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '职位',
  `dotime` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '增加时间',
  `uptime` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_userinfo_phone_number` (`phone_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
