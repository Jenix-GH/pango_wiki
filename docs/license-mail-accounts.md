# 平台邮箱与 FAE 邮箱分开发送（后台 v5.3）

| 邮件 | 实际发件账号 | 收件人 |
|---|---|---|
| 09:00 待处理汇总 | 平台邮箱 | 唯一 FAE 邮箱 |
| 20:00 发放结果汇总 | 平台邮箱 | 唯一 FAE 邮箱 |
| 客户 License 附件 | FAE 邮箱 | 每条申请填写的客户邮箱 |
| 客户拒绝说明 | FAE 邮箱 | 每条申请填写的客户邮箱 |

仍由后台定时任务自动执行，不需要 FAE 手工点发送；FAE 负责取得并上传文件。SMTP 服务必须允许以该 FAE 身份发信，需要 FAE 账号的 SMTP 凭据或邮件管理员授予的发信权限。

## 推荐：在后台设置 FAE 邮箱

进入“License 发放 → 邮件设置与测试”。填写 FAE 邮箱、SMTP 密码/授权码、服务器、端口和加密方式，点击“保存 FAE 邮箱”。此邮箱同时作为平台通知的收件人和客户邮件的发件人；客户收件地址仍来自申请。

首次保存或更换邮箱、服务器、登录名时必须填写密码；之后留空可保留原密码。页面只返回“已保存”状态，不回显密码。后台保存的账号优先于手工 FAE 配置文件。平台账号仍由原 LICENSE_MAIL_ENV 指定，不在该表单修改。

FAE 密码使用 AES-256-GCM 加密保存到实际后台配置目录的 license-mail-settings.json，配套密钥是同目录 .license-mail-settings.key，文件权限均为 0600；两者均不提交 Git，部署备份会保留整个 config 目录。需使用同一服务账号运行后台与定时任务，或由运维设置受控读取权限。备份、回退时要保留这两个配套文件。密钥与加密文件保存在同一服务器，不能代替服务器访问权限控制。

## 可选：两份私有邮箱配置

平台原来的 `/home/sjchen/license-notify/.env` 保留平台账号，不要改成 FAE 账号。另行创建 `/home/sjchen/license-notify/fae.env`；以下均为示例，实际路径按服务器配置填写。

每份文件分别包含：

```dotenv
MAIL_ADDRESS=该文件对应的发件邮箱
MAIL_PASSWORD=该邮箱的SMTP密码或授权码
SMTP_HOST=该邮箱实际SMTP服务器
SMTP_PORT=该邮箱实际SMTP端口
SMTP_SECURITY=该邮箱实际加密方式
```

沿用原 mail_client 支持的配置格式；若配置 MAIL_USERNAME、MAIL_DISPLAY_NAME、SMTP_AUTH 等字段，应分别核对对应账号，不能只改 MAIL_ADDRESS 而沿用另一账号的密码。两份文件不要提交到 Git，限制为实际任务运行账号可读。

## 后台配置

在实际 `config/database.env` 中保留原数据库/后台设置，增加或修改：

```dotenv
LICENSE_DELIVERY_ENABLED=true
LICENSE_SEND_ENABLED=false
LICENSE_FAE_EMAIL=实际FAE邮箱
LICENSE_REPLY_TO=实际FAE邮箱
LICENSE_MAIL_ENV=/home/sjchen/license-notify/.env
LICENSE_FAE_MAIL_ENV=/home/sjchen/license-notify/fae.env
LICENSE_PYTHON=/usr/bin/python3
```

`LICENSE_FAE_EMAIL` 同时是平台通知的接收地址和 FAE 发信身份；FAE 文件中的 MAIL_ADDRESS 必须与其一致。客户邮箱来自申请，无需配置。LICENSE_REPLY_TO 只是回复地址，不是发件身份或抄送。

既未在后台保存 FAE 账号、也没有可读的 FAE 配置文件时，夜间任务停止，不处理发信队列；实际 FAE 发件人不符时，客户邮件会失败并保留记录，不连接 SMTP，也不改用平台账号。失败配置修复后按原失败重试规则处理；结果不明仍需人工核查，不能直接重发。早间平台通知只依赖平台配置。

准备模式不发邮件。上传脚本保留原配置值，不会自动生成 FAE 凭据；若当前已启用定时发送，更新前先暂停新任务并关闭发送开关，防止部署期间旧版继续使用单邮箱。测试完成后再按原交接说明启用，不并行运行旧 license-notify 任务。

## 在后台修改正文并测试

1. “邮件内容”中选择客户 License、拒绝说明或 FAE 汇总，修改标题和正文；点击变量按钮插入申请字段。
2. 拒绝说明必须保留 {{拒绝原因}}，FAE 汇总必须保留 {{原始正文}}；附件与实际收件人不受模板修改影响。
3. 填写自己的“测试收件邮箱”，点击“预览当前内容”，确认标题、正文、附件名称和发件身份。
4. 勾选测试发送确认，点击“发送一封测试邮件”。仅将当前类型的一封虚构数据邮件发到指定邮箱；即使处于准备模式也能手动测试，不会启用自动任务或更新生产申请。
5. 点击“保存邮件内容”后用于后续生成邮件。预览和测试使用当前草稿，不要求先保存模板；发信账号使用已经保存的账号。已生成的 FAE 失败批次重试仍保留原始内容。

以上操作要求登录管理后台。它使用现有授权后台账号，没有新增独立的 FAE 登录体系。邮件服务接受不代表最终投递成功，请检查收件箱/垃圾邮件；结果不明时先核对 Message-ID，不直接重发。

## 也可使用独立测试脚本

使用更新后的 `scripts/test-license-mails.mjs`，也可将同内容的独立文件上传到 `/tmp/test-license-mails.mjs`。以下用后台脚本路径举例：

```bash
node /home/sjchen/adminconsole/scripts/test-license-mails.mjs \
  --admin-dir /home/sjchen/adminconsole --to '你自己的测试邮箱'
```

默认仅预览。核对后加 `--send`，将一封汇总（平台发件）、一封 License（FAE 发件）、一封拒绝说明（FAE 发件）都发到指定测试邮箱。需要时可用 `--mail-env`、`--fae-mail-env` 指定两份私有文件的绝对路径。测试通过同一个分流及 SMTP 程序执行，使用虚构申请和无效测试 License，不读取/修改生产申请，不修改发送开关或 cron。发生失败或结果不明立即停止后续测试邮件。

本次邮箱配置和模板功能没有新增数据库迁移。同期更新了 Web/小程序申请表的布局和小程序 License 登录时的头像保留逻辑，Java 与原有 50 次判断均不变。真实 SMTP 权限和投递效果、微信真机显示仍需验收。
