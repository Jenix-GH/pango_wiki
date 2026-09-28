# License 自动发放部署与验收

本文说明 `Pango-Admin-Console/` 中的自动发放功能。完整的申请与个人中心更新还涉及 Web、小程序和 Java，须同时阅读 [License 个人中心部署说明](license-portal-deployment.md)。License 生成工具不需要改动。

## 已实现的行为

- 四个业务状态：0 待处理（刚提交）、1 处理中（FAE 通知发送成功）、2 已处理（License 已上传并唯一匹配）、3 已拒绝（已保存拒绝理由）。业务状态与客户邮件发送结果分开。
- 09:00 北京时间：把待处理申请汇总给唯一 FAE，附 CSV；邮件服务接受后才把这批申请转为处理中。无新待办或异常不发空邮件。已进入处理中的申请不再作为新申请重复通知。
- FAE 批量上传 `new_pds_<12位十六进制MAC>.lic`，最多 50 个/批、1 MB/个、10 MB/批。文件私有保存在 MySQL，避免后台换版本时遗失附件；数据库备份需覆盖新表。
- 初步匹配结果即时显示；20:00 前完整上传的文件进入当晚批次，之后进入下一晚。
- 20:00 再次核对，正常 License 和拒绝说明分别发送给对应客户；拒绝邮件包含完整理由、不带 License 附件。发送结果反馈给 FAE。
- 申请页支持按提交日期（含结束当天）与四状态组合筛选；文件页支持按上传日期与文件状态筛选。
- 唯一 MAC 匹配、合法邮箱、文件 SHA-256、申请信息快照及重复发送检查。
- 冲突项可选择申请、取消多余文件并重新匹配；已拒绝申请不发送。文件名校验不等于授权内容校验。
- 支持暂停、取消、失败后核对重试，以及结果不明时登记核查结论。已成功发放的申请不提供无条件补发按钮；如客户确需重新发放，后续可增加独立补发审批/确认入口。
- 明确失败最多自动尝试 3 次，下一晚继续；同一晚手动重复运行也计入此上限。结果不明不自动重发，需核查 Message-ID。
- 初始上线仅处理新上传文件，不会从旧申请凭空生成发放任务。

新汇总会在确认发给 FAE 后同步业务状态；旧脚本不会更新状态，不能继续并行运行。切换时保留原脚本与 state.json 供核对和回退，但禁用旧 cron 条目。汇总邮件保存完整内容及申请成员，失败重试只重发原批，不会把后续新增申请错误标为处理中。发送结果不明时，可在“最近 FAE 汇总邮件”中按 Message-ID 核查后登记结果。

## 1. 备份与迁移

先备份现有业务库及服务器配置。把后台源码部署到实际后台目录（例如 `/home/sjchen/adminconsole`），保留原 `config/database.env`。

累计九张 InnoDB 工作流表：

- `dto_license_file`：上传内容、批次、MAC、申请快照、匹配及发放状态。
- `dto_license_mail`：客户发放和 FAE 汇总的去重键、Message-ID、结果。
- `dto_license_delivery_audit`：上传、操作及发送审计记录。
- `dto_license_digest_batch`、`dto_license_digest_item`：FAE 邮件原始内容、申请成员和快照。
- `dto_license_rejection`：拒绝理由、操作人、收件人及说明邮件处理结果。
- `dto_license_status_change`：人工设置前后状态、操作人、时间及修改前的拒绝记录快照。

另有 `dto_license_cc`（单条邮件抄送设置）和 `dto_license_mail_recipients`（发送收件人历史）。

按顺序执行 `database/20260923_license_delivery.sql`、`database/20260923_license_workflow.sql`、`database/20260924_license_manual_status.sql`、`database/20260928_license_cc.sql`。已执行前三份的升级用户只需补执行第四份，旧迁移不改写。下面的 migrate 命令会按顺序执行全部幂等建表文件：

```bash
cd /home/sjchen/adminconsole
npm ci
node scripts/license-worker.mjs migrate --config /安全目录/迁移配置.env
npm test
npm run build
```

迁移配置只需 PANGO_DB_HOST、PANGO_DB_PORT、PANGO_DB_NAME、PANGO_DB_USER、PANGO_DB_PASSWORD。`migrate` 只建表，不发邮件。不要把迁移账号的高权限长期交给运行时。

运行账号需要：现有业务表读取权限、原来的反馈/申请状态更新权限，以及新增七表的 SELECT/INSERT/UPDATE 权限。新增表不需要 DELETE 权限。

```sql
-- 将 agent_db、pango_console 和来源主机替换为实际配置。
GRANT SELECT, INSERT, UPDATE ON agent_db.dto_license_file TO 'pango_console'@'控制台来源主机';
GRANT SELECT, INSERT, UPDATE ON agent_db.dto_license_mail TO 'pango_console'@'控制台来源主机';
GRANT SELECT, INSERT, UPDATE ON agent_db.dto_license_delivery_audit TO 'pango_console'@'控制台来源主机';
GRANT SELECT, INSERT, UPDATE ON agent_db.dto_license_digest_batch TO 'pango_console'@'控制台来源主机';
GRANT SELECT, INSERT, UPDATE ON agent_db.dto_license_digest_item TO 'pango_console'@'控制台来源主机';
GRANT SELECT, INSERT, UPDATE ON agent_db.dto_license_rejection TO 'pango_console'@'控制台来源主机';
GRANT SELECT, INSERT, UPDATE ON agent_db.dto_license_status_change TO 'pango_console'@'控制台来源主机';
```

`max_allowed_packet` 建议不低于 16 MB；请求 JSON 上限约 15 MB。反向代理的请求体限制需与之匹配，否则批量上传会被代理拒绝。每个 SQL INSERT 只插入一个最多 1 MB 的文件。

## 2. 配置与准备模式

在后台现有 `config/database.env` 增加：

```dotenv
LICENSE_DELIVERY_ENABLED=true
LICENSE_SEND_ENABLED=false
LICENSE_FAE_EMAIL=实际FAE邮箱
LICENSE_REPLY_TO=实际FAE邮箱
LICENSE_MAIL_ENV=/home/sjchen/license-notify/.env
LICENSE_FAE_MAIL_ENV=/home/sjchen/license-notify/fae.env
LICENSE_PYTHON=/usr/bin/python3
```

优先通过后台“License 发放 → 邮件设置与测试”保存 FAE 账号、修改正文并发送单封测试邮件。后台保存的账号覆盖以下手工 FAE 配置；平台配置继续保留。

`LICENSE_MAIL_ENV` 指向平台 SMTP 配置，仅用于给 `LICENSE_FAE_EMAIL` 发送早间汇总和夜间发放结果。`LICENSE_FAE_MAIL_ENV` 指向另一份 FAE SMTP 配置，用于发送客户 License 和拒绝说明；其中 `MAIL_ADDRESS` 必须与 `LICENSE_FAE_EMAIL` 一致，并填写该 FAE 邮箱的 SMTP 密码/授权码（如有 `MAIL_USERNAME`，也需核对）。两份文件不能指向同一实际文件。SMTP_HOST/SMTP_PORT/SMTP_SECURITY 等按各自邮箱服务配置。

未配置 FAE 发信文件时，夜间任务在处理数据库队列前停止，不会用平台邮箱代发；发件地址不匹配则在连接 SMTP 前拒绝发送。早间汇总可以只配置平台邮箱。运行账号需能读取对应文件，密码仅保留在服务器上，不提供给开发会话。邮件子进程不继承外层 MAIL_/SMTP_/POP3_ 环境变量，以免平台凭据覆盖 FAE 配置。

`mail_client.py` 来自用户提供的 license-notify-code.tar.gz。JSON stdin 桥接程序复用其 SMTP 能力；邮件类型明确选择平台或 FAE 配置。实际 From 来自所选文件的 MAIL_ADDRESS，LICENSE_REPLY_TO 仅控制客户点击回复的地址，不能代替 FAE 发信凭据。详见 [双邮箱配置与测试](license-mail-accounts.md)。

准备模式允许上传、核对、填写拒绝理由及保存状态，邮件留在队列中，但脚本拒绝实际发送。重启后台后可在“License 发放”查看准备模式提示。

上线前核对历史状态：原 status=2 表示“已通过”，不能未经核查就视为新版“已上传 License”。已由旧脚本通知 FAE 的记录，需要结合旧 state.json/邮件记录确认后迁移为处理中；已有上传关联的记录可核对后迁移为已处理。建表脚本不会擅自重写历史状态。FAE 邮箱与客户邮箱应正确，上传的应是准备交付的文件。若历史申请同 MAC 有多条，界面会要求人工选择。

## 3. 启用自动发放与计划任务

本地开发不会修改服务器 crontab。上线验证通过后，把 `LICENSE_SEND_ENABLED` 改为 `true`，重启后台以同步界面状态；worker 每次启动重新读取配置。

查看实际 Node 路径：

```bash
command -v node
crontab -l
```

备份 crontab，编辑时移除或注释旧 `/home/sjchen/license-notify/run-daily.sh` 条目，再为新后台加入一条每小时整点检查的任务：

```cron
# 以下 /usr/bin/node 和 /home/sjchen/adminconsole 必须替换为实际路径。
0 * * * * LICENSE_NODE_BIN=/usr/bin/node /bin/sh /home/sjchen/adminconsole/scripts/run-license-job.sh >> /var/lib/pango-license-notify/delivery-cron.log 2>&1
```

包装脚本只在北京时间 09:00 和 20:00 运行对应任务，因此服务器本地时区为 UTC 也可以沿用这条 cron。日志目录须存在且执行账号可写。使用 `LICENSE_CONFIG_FILE` 可指定其他配置文件路径。

任务是服务器计划任务，不依赖后台页面保持打开。多实例/重复触发使用数据库级命名锁，已发送邮件使用持久化去重键。锁占用时上传或人工操作会提示稍后重试。

运维手动运行命令（会真实发信，且限制在相应北京时间小时内）：

```bash
node scripts/license-worker.mjs digest
node scripts/license-worker.mjs nightly
```

早间和夜间发放不共用原脚本的 `last_notified_id`；不要清空旧脚本 state.json 来“重新初始化”新系统。

## 4. 异常处理

- 无匹配：核对文件名及是否已有申请；重新匹配。
- 多条申请：查看软件版本、年限、公司和邮箱，选择具体申请，填写核对说明。
- 同 MAC 多文件：先取消多余文件，再对正确文件重新匹配。相同内容的重复上传标记为重复，不重发。
- 申请信息变化：会停止自动发送；核对变更与 License 内容，填写依据后重新匹配。
- 邮箱/连接明确失败：先修复邮箱或配置；自动最多三次，超过后可填写说明重新排队。
- 结果待核查：按 Message-ID 检查邮件服务日志。已发出则登记“已核实发出”；确定未发出则登记“已核实未发出”，系统保持暂停，需再次核对匹配后排队。
- 拒绝必须填写 1–2000 字理由，说明原文会发给客户；拒绝同时取消该申请未发出的附件。已发出的 License 或结果待核查的发放不能直接拒绝。
- 重复提交同一拒绝不会重复排队。拒绝邮件失败或结果不明不会把业务状态从已拒绝改回待处理；从“拒绝详情 / 邮件”核查或重新排队。历史拒绝没有理由的，需要人工补充后才会安排说明邮件，不自动编造理由。
- SMTP 服务已接受不等于客户收件。首版不接入退信解析或送达回执。
- 任务运行中进程中断：持久化 sending 标记下一次转为 unknown，不盲目重发。

后台支持人工下拉设置四状态，同时保留自动推进。选择已拒绝会打开理由表单，取消填写不改状态。人工标记不会伪造上传或发信记录，不会重发已经成功发放的 License；原有待发送文件仍按队列处理，如需停发，请另行暂停文件。夜间仅复查文件不会覆盖此前的人工状态。

把已拒绝改回其他状态，会取消尚未发送的拒绝通知，保留已发送记录和完整旧理由；之后再次拒绝形成新的通知轮次。取消过的附件不会自动恢复，需要重新上传。人工操作带状态版本核对，页面已过期或邮件正在发送/结果待核查时需先刷新或核查。已成功发送 License 的记录仍不能直接拒绝，以免误把状态改动当成撤销授权。不能再使用旧 Java `/admin/console/licenses/{id}/status` 或其他脚本直接修改状态；它们不支持拒绝邮件，应在部署层保持禁用（现用 Node 后台本来不调用该接口）。夜间发信对申请行加锁并核对快照，避免联系信息在发送过程中变化。

## 5. 验证命令

```bash
npm test
npm run build
python3 tests/license_mail_bridge_test.py
```

前两项包含原问答导出验证、MAC/附件/时间规则及邮件异常分类。桥接测试仅连接本机临时假 SMTP，不使用企业邮箱。

MySQL 集成测试只允许专用的本机测试库 `pango_license_test`、13316 端口，运行时会清空该测试库的八张表：

```bash
# 仅在本机测试环境创建一次，使用临时存储。
docker run -d --rm --name pango-license-test -p 127.0.0.1:13316:3306 \
  -e MYSQL_ROOT_PASSWORD=local-test-only -e MYSQL_DATABASE=pango_license_test \
  --tmpfs /var/lib/mysql mysql:8.0.39 --max-allowed-packet=33554432
LICENSE_MYSQL_TEST=1 npm run test:delivery:mysql
docker stop pango-license-test
```

需要先等待 MySQL 完成初始化。该测试不连接生产数据库，也不使用真实 SMTP。

## 6. 回退

先关闭 LICENSE_SEND_ENABLED 并停止新 cron，再回退后台代码。保留新表和文件内容，不能删除发送记录，否则会失去去重依据。只有确认没有重复通知风险时才恢复旧早间脚本。回退不会撤回已经发出的邮件。
