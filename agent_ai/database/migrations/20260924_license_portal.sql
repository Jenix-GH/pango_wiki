-- Apply once after the three Admin Console License workflow migrations.
-- Historical ownership is unverified: preserve records without exposing them to clients.
ALTER TABLE dto_license_application
  ADD COLUMN official_submitted TINYINT(1) NULL DEFAULT NULL COMMENT '用户声明已在官网提交，NULL=历史未记录',
  ADD COLUMN owner_verified TINYINT(1) NOT NULL DEFAULT 0 COMMENT '由服务端认证登录身份关联',
  ADD INDEX idx_license_owner (userinfo_id, owner_verified, dotime, id);
