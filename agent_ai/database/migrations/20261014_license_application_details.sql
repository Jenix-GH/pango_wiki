-- Apply once to the existing business database before deploying Java and the clients.
-- Additive only: preserve all historical applications, statuses and notification records.
ALTER TABLE dto_license_application
  ADD COLUMN email_type VARCHAR(30) NULL DEFAULT NULL COMMENT 'ORGANIZATION=公司或学校邮箱，PERSONAL=个人邮箱，NULL=历史未填写',
  ADD COLUMN contact_person VARCHAR(100) NULL DEFAULT NULL COMMENT 'FAE或渠道负责人姓名',
  ADD COLUMN max_users INT NULL DEFAULT NULL COMMENT '服务器版最大支持人数，NULL=历史未填写或单机版';
