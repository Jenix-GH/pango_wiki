-- Add an optional screenshot to answer-quality feedback.
ALTER TABLE `dto_feedback`
  ADD COLUMN `feedback_images` longtext COLLATE utf8mb4_unicode_ci DEFAULT NULL
  COMMENT '反馈图片，JSON数组，最多1张且单张不超过15MB'
  AFTER `answer_content`;
