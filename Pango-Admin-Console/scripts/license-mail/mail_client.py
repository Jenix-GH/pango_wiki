#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""pango_wiki 邮件客户端 —— 发信用 SMTP，收信用 POP3。

服务器默认值（可用 .env 覆盖）：
    发件 SMTP: mail.pangomicro.com:25   （TurboEx，支持 AUTH LOGIN / PLAIN，不广播 STARTTLS）
    收件 POP3: mail.pangomicro.com:110  （明文 USER/PASS）

账号密码只从 .env 读取，不写入命令行、不打印到日志。

用法示例：
    python mail_client.py check                       # 校验账号能否登录发件/收件服务器
    python mail_client.py send --to a@x.com --subject 测试 --body "你好"
    python mail_client.py send --to a@x.com,b@x.com --body-file body.html --html --attach 报表.xlsx
    python mail_client.py list --limit 10             # 查看最近 10 封（只拉信封头）
    python mail_client.py fetch --last 1 --save-dir ./inbox
    python mail_client.py fetch --index 12 --delete   # 下载后从服务器删除
"""

from __future__ import annotations

import argparse
import mimetypes
import os
import poplib
import smtplib
import ssl
import sys
from dataclasses import dataclass
from email import message_from_bytes, policy
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.utils import formataddr, getaddresses, parsedate_to_datetime
from pathlib import Path
from typing import Iterable, Sequence

EXIT_OK = 0
EXIT_USAGE = 1
EXIT_AUTH = 2
EXIT_CONN = 3
EXIT_CONFIG = 4
EXIT_MAIL = 5

DEFAULT_ENV_PATH = Path(__file__).resolve().parent / ".env"


class MailAuthError(Exception):
    """账号密码被服务器拒绝，或凭据无法按协议编码。"""


class UsageError(Exception):
    """命令行用法问题，例如未指定邮件序号、附件不存在。"""

ENV_TEMPLATE = """# pango_wiki 邮件账号配置（本文件不要提交到仓库）
MAIL_ADDRESS=your.name@pangomicro.com
MAIL_PASSWORD=你的密码
MAIL_DISPLAY_NAME=Pango Wiki

# 发件服务器（SMTP）
SMTP_HOST=mail.pangomicro.com
SMTP_PORT=25
SMTP_SECURITY=auto          # auto | none | starttls | ssl
SMTP_AUTH=auto              # auto | login | plain | none

# 收件服务器（POP3）
POP3_HOST=mail.pangomicro.com
POP3_PORT=110
POP3_SECURITY=auto          # auto | none | stls | ssl
"""


# --------------------------------------------------------------------------- #
# 配置
# --------------------------------------------------------------------------- #
def parse_env_file(path: Path) -> dict[str, str]:
    """极简 .env 解析器：支持 KEY=VALUE、引号、注释、export 前缀、UTF-8 BOM。

    若安装了 python-dotenv，则优先使用它解析（容错更好）。
    注意：Windows 记事本/PowerShell 保存的 .env 常带 BOM，这里统一按 utf-8-sig 读取并剥掉
    可能残留在键名里的 BOM 字符，否则会出现"配置存在却读不到"的假象。
    """
    if not path.is_file():
        raise FileNotFoundError(path)

    try:  # 可选依赖，缺失时回退到内置解析
        from dotenv import dotenv_values  # type: ignore

        raw_values = dotenv_values(path, encoding="utf-8-sig")
        return {k.lstrip("\ufeff").strip(): (v or "") for k, v in raw_values.items() if k}
    except ImportError:
        pass

    data: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.lower().startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        elif " #" in value:
            value = value.split(" #", 1)[0].strip()
        data[key] = value
    return data


def resolve_security(raw: str, port: int, receiver: bool) -> str:
    """把 SMTP_SECURITY / POP3_SECURITY 归一化成 none|starttls|stls|ssl。"""
    value = (raw or "auto").strip().lower()
    if value in {"", "auto"}:
        if port == 465:
            return "ssl"
        if port == 995:
            return "ssl"
        if port in {587, 2587}:
            return "starttls" if not receiver else "stls"
        return "none"  # 25 / 110：TurboEx 明文，且不广播 STARTTLS
    if value in {"plain", "off", "false", "0", "no"}:
        return "none"
    if value in {"tls", "starttls"}:
        return "starttls"
    if value in {"stls"}:
        return "stls"
    if value in {"ssl", "smtps", "pop3s", "on", "true", "1", "yes"}:
        return "ssl"
    raise ValueError(f"无法识别的加密方式: {raw!r}（可选 auto/none/starttls/ssl）")


@dataclass
class Config:
    address: str
    password: str
    display_name: str = ""
    smtp_host: str = "mail.pangomicro.com"
    smtp_port: int = 25
    smtp_security: str = "none"
    smtp_auth: str = "auto"
    pop3_host: str = "mail.pangomicro.com"
    pop3_port: int = 110
    pop3_security: str = "none"
    username: str = ""
    timeout: int = 30
    insecure: bool = False

    @property
    def smtp_user(self) -> str:
        return self.username or self.address


def load_config(env_path: Path, args: argparse.Namespace) -> Config:
    """读取 .env，并用命令行参数覆盖（命令行只允许覆盖服务器/端口等非敏感项）。"""
    values = parse_env_file(env_path)

    def pick(*names: str, default: str = "") -> str:
        for name in names:
            if os.environ.get(name):  # 真实环境变量优先，便于 CI/临时覆盖
                return os.environ[name].strip()
            if values.get(name):
                return values[name].strip()
        return default

    address = pick("MAIL_ADDRESS", "MAIL_FROM", "SMTP_USER", default="")
    password = pick("MAIL_PASSWORD", "MAIL_PASS", "SMTP_PASSWORD", default="")
    if not address or not password:
        raise ValueError(
            f"{env_path} 中缺少 MAIL_ADDRESS 或 MAIL_PASSWORD。\n"
            f"可执行 `python {Path(__file__).name} init-env` 生成模板。"
        )

    smtp_host = args.smtp_host or pick("SMTP_HOST", default="mail.pangomicro.com")
    smtp_port = int(args.smtp_port or pick("SMTP_PORT", default="25"))
    pop3_host = args.pop3_host or pick("POP3_HOST", default="mail.pangomicro.com")
    pop3_port = int(args.pop3_port or pick("POP3_PORT", default="110"))
    smtp_security = getattr(args, "smtp_security", None) or pick("SMTP_SECURITY", default="auto")
    pop3_security = getattr(args, "pop3_security", None) or pick("POP3_SECURITY", default="auto")

    return Config(
        address=address,
        password=password,
        display_name=pick("MAIL_DISPLAY_NAME", default=""),
        smtp_host=smtp_host,
        smtp_port=smtp_port,
        smtp_security=resolve_security(smtp_security, smtp_port, False),
        smtp_auth=(getattr(args, "smtp_auth", None) or pick("SMTP_AUTH", default="auto")).lower(),
        pop3_host=pop3_host,
        pop3_port=pop3_port,
        pop3_security=resolve_security(pop3_security, pop3_port, True),
        username=pick("MAIL_USERNAME", default=""),
        timeout=int(pick("MAIL_TIMEOUT", default="30")),
        insecure=bool(args.insecure),
    )


def ssl_context(cfg: Config) -> ssl.SSLContext:
    if cfg.insecure:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    return ssl.create_default_context()


def log(message: str, *, quiet: bool = False) -> None:
    if not quiet:
        print(message, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------- #
# SMTP：发信
# --------------------------------------------------------------------------- #
def connect_smtp(cfg: Config, *, debug: bool = False):
    if cfg.smtp_security == "ssl":
        server = smtplib.SMTP_SSL(cfg.smtp_host, cfg.smtp_port, timeout=cfg.timeout, context=ssl_context(cfg))
    else:
        server = smtplib.SMTP(cfg.smtp_host, cfg.smtp_port, timeout=cfg.timeout)
    if debug:
        server.set_debuglevel(1)

    server.ehlo()
    if cfg.smtp_security == "starttls":
        if server.has_extn("starttls"):
            server.starttls(context=ssl_context(cfg))
            server.ehlo()
        else:
            log(f"提示：{cfg.smtp_host}:{cfg.smtp_port} 未广播 STARTTLS，已按明文继续。")
    return server


def _auth_plain(server, cfg: Config) -> None:
    import base64

    token = base64.b64encode(f"\0{cfg.smtp_user}\0{cfg.password}".encode()).decode()
    code, resp = server.docmd("AUTH", f"PLAIN {token}")
    if code != 235:
        raise smtplib.SMTPAuthenticationError(code, resp)


def _auth_login(server, cfg: Config) -> None:
    import base64

    code, resp = server.docmd("AUTH", "LOGIN")
    if code != 334:
        raise smtplib.SMTPAuthenticationError(code, resp)
    server.docmd(base64.b64encode(cfg.smtp_user.encode()).decode())
    code, resp = server.docmd(base64.b64encode(cfg.password.encode()).decode())
    if code != 235:
        raise smtplib.SMTPAuthenticationError(code, resp)


def smtp_auth_plan(cfg: Config, server) -> list[str | None]:
    """决定按什么顺序尝试 AUTH 机制；None 表示不认证。"""
    if cfg.smtp_auth == "none":
        return [None]
    if cfg.smtp_auth in {"login", "plain"}:
        return [cfg.smtp_auth]
    advertised = server.esmtp_features.get("auth", "").upper().split()
    plan: list[str] = [m for m in ("PLAIN", "LOGIN") if m in advertised]
    return [m.lower() for m in plan] or ["login"]


def open_authenticated_smtp(cfg: Config, *, debug: bool = False, quiet: bool = False):
    """建立并登录 SMTP 连接。

    实测 TurboEx（mail.pangomicro.com:25）在 AUTH 失败后会立刻断开连接，此时 smtplib 自动
    回退到下一种机制只会拿到 "Connection unexpectedly closed" 这种误导性报错。这里按机制
    显式重连重试，并把 535（凭据无效）与断连区分开：凭据无效直接失败，不再换机制重试，
    避免连续失败触发账号锁定。
    """
    server = connect_smtp(cfg, debug=debug)
    try:
        plan = smtp_auth_plan(cfg, server)
    except smtplib.SMTPException:
        plan = ["login"]
    if plan == [None]:
        return server

    last_exc: Exception | None = None
    for position, mechanism in enumerate(plan):
        if position > 0:  # 上一种机制把连接弄断了，另起一条连接再试
            log(f"提示：改用 AUTH {mechanism.upper()} 重新连接重试。", quiet=quiet)
            try:
                server.close()
            except Exception:
                pass
            try:
                server = connect_smtp(cfg, debug=debug)
            except (smtplib.SMTPException, OSError) as exc:
                last_exc = exc
                break
        try:
            # 凭据以 base64(UTF-8) 形式写入 AUTH 命令，命令本身恒为 ASCII，
            # 因此不需要 smtplib.login() 的 ASCII 限制（它会对非 ASCII 密码直接抛异常）。
            (_auth_plain if mechanism == "plain" else _auth_login)(server, cfg)
            return server
        except smtplib.SMTPAuthenticationError as exc:
            last_exc = exc
            if exc.smtp_code == 535:  # 凭据无效：换机制也一样，直接失败
                break
            continue
        except smtplib.SMTPServerDisconnected as exc:
            last_exc = exc
            continue

    try:
        server.close()
    except Exception:
        pass
    if isinstance(last_exc, smtplib.SMTPAuthenticationError):
        raise last_exc
    if isinstance(last_exc, smtplib.SMTPServerDisconnected):
        raise MailAuthError(
            "发件服务器在认证过程中直接断开了连接（常见于密码错误或账号被锁定/限流）。"
            f"原始错误：{last_exc}"
        ) from last_exc
    raise MailAuthError(f"SMTP 认证失败：{last_exc or '服务器未提供可用的 AUTH 机制'}")


def split_addresses(values: Iterable[str] | None) -> list[str]:
    if not values:
        return []
    joined = ",".join(values)
    return [addr for _name, addr in getaddresses([joined]) if addr]


def build_message(cfg: Config, args: argparse.Namespace) -> tuple[EmailMessage, list[str]]:
    to_list = split_addresses(args.to)
    cc_list = split_addresses(args.cc)
    bcc_list = split_addresses(args.bcc)
    if not to_list and not cc_list and not bcc_list:
        raise UsageError("至少需要一个收件人：--to / --cc / --bcc")

    msg = EmailMessage()
    from_addr = args.sender or cfg.address
    msg["From"] = formataddr((cfg.display_name, from_addr)) if cfg.display_name else from_addr
    if to_list:
        msg["To"] = ", ".join(to_list)
    if cc_list:
        msg["Cc"] = ", ".join(cc_list)
    if args.subject:
        msg["Subject"] = args.subject
    if args.reply_to:
        msg["Reply-To"] = args.reply_to

    body = args.body
    if args.body_file:
        body = Path(args.body_file).read_text(encoding="utf-8")
    if body is None:
        if sys.stdin is not None and not sys.stdin.isatty():
            body = sys.stdin.buffer.read().decode("utf-8", "replace")
        else:
            body = ""
    if args.html:
        msg.set_content("此邮件为 HTML 格式，请使用支持 HTML 的客户端查看。", charset="utf-8")
        msg.add_alternative(body, subtype="html", charset="utf-8")
    else:
        msg.set_content(body, charset="utf-8")

    for item in args.attach or []:
        path = Path(item)
        if not path.is_file():
            raise UsageError(f"附件不存在：{path}")
        ctype, _encoding = mimetypes.guess_type(path.name)
        maintype, _, subtype = (ctype or "application/octet-stream").partition("/")
        msg.add_attachment(
            path.read_bytes(),
            maintype=maintype,
            subtype=subtype or "octet-stream",
            filename=path.name,
        )

    return msg, to_list + cc_list + bcc_list


def cmd_send(cfg: Config, args: argparse.Namespace) -> int:
    msg, recipients = build_message(cfg, args)
    if args.dry_run:
        print(msg.as_string())
        log(f"[dry-run] 未发送；收件人 {len(recipients)} 个。", quiet=args.quiet)
        return EXIT_OK

    log(f"连接发件服务器 {cfg.smtp_host}:{cfg.smtp_port}（{cfg.smtp_security}）…", quiet=args.quiet)
    try:
        with open_authenticated_smtp(cfg, debug=args.debug, quiet=args.quiet) as server:
            server.send_message(msg, from_addr=cfg.address, to_addrs=recipients)
    except (smtplib.SMTPAuthenticationError, MailAuthError) as exc:
        detail = (
            f"{exc.smtp_code} {exc.smtp_error!r}"
            if isinstance(exc, smtplib.SMTPAuthenticationError)
            else str(exc)
        )
        log(f"发件鉴权失败：{detail}（请检查 .env 的 MAIL_ADDRESS / MAIL_PASSWORD）", quiet=args.quiet)
        return EXIT_AUTH
    except (smtplib.SMTPException, OSError, ssl.SSLError) as exc:
        log(f"发件失败：{type(exc).__name__}: {exc}", quiet=args.quiet)
        return EXIT_MAIL
    log(f"已发送给 {', '.join(recipients)}", quiet=args.quiet)
    return EXIT_OK


# --------------------------------------------------------------------------- #
# POP3：收信
# --------------------------------------------------------------------------- #
def pop_error_text(exc: BaseException) -> str:
    """poplib 把服务器响应作为 bytes 放进异常，这里转成可读文本。"""
    parts = []
    for item in getattr(exc, "args", ()) or ():
        parts.append(item.decode("utf-8", "replace") if isinstance(item, bytes) else str(item))
    return " ".join(parts) or str(exc)


class Pop3Session:
    """给 poplib.POP3 套一层上下文管理。

    poplib.POP3 与 smtplib.SMTP 不同，**没有实现 __enter__/__exit__**，因此 `with connect_pop3(...)`
    会直接抛 AttributeError: __enter__。退出时发送 QUIT（POP3 靠 QUIT 提交 DELE），
    失败时退回 close()，避免连接泄漏。
    """

    def __init__(self, conn):
        self._conn = conn

    def __enter__(self):
        return self._conn

    def __exit__(self, exc_type, exc, traceback) -> bool:
        try:
            self._conn.quit()
        except Exception:
            try:
                self._conn.close()
            except Exception:
                pass
        return False


def connect_pop3(cfg: Config, *, debug: bool = False) -> Pop3Session:
    if cfg.pop3_security == "ssl":
        conn = poplib.POP3_SSL(cfg.pop3_host, cfg.pop3_port, timeout=cfg.timeout, context=ssl_context(cfg))
    else:
        conn = poplib.POP3(cfg.pop3_host, cfg.pop3_port, timeout=cfg.timeout)
    if debug:
        conn.set_debuglevel(2)
    try:
        if cfg.pop3_security == "stls":
            conn.stls(context=ssl_context(cfg))
        conn.user(cfg.smtp_user)
        conn.pass_(cfg.password)
    except poplib.error_proto as exc:
        try:
            conn.quit()
        except Exception:
            pass
        raise MailAuthError(f"POP3 登录被拒绝：{pop_error_text(exc)}") from exc
    except UnicodeEncodeError as exc:
        try:
            conn.quit()
        except Exception:
            pass
        raise MailAuthError("账号或密码含无法按 POP3 协议编码的字符，请检查 .env。") from exc
    return Pop3Session(conn)


def decode_header_value(value: str | None) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:  # 容错：个别邮件头编码非法
        return value


def parse_message(raw: bytes) -> EmailMessage:
    """按 modern API 解析（EmailMessage），否则拿不到 get_body()/get_content()。"""
    return message_from_bytes(raw, policy=policy.default)


def message_summary(msg) -> str:
    date = decode_header_value(msg.get("Date"))
    try:
        date = parsedate_to_datetime(msg.get("Date")).astimezone().strftime("%Y-%m-%d %H:%M")
    except Exception:
        pass
    sender = decode_header_value(msg.get("From"))
    subject = decode_header_value(msg.get("Subject")) or "(无主题)"
    return f"{date:>16}  {sender[:38]:<38}  {subject}"


def fetch_headers(conn, index: int) -> bytes:
    """优先用 TOP 只取头部；服务器不支持时退回 RETR。返回原始头部字节。"""
    try:
        _resp, lines, _octets = conn.top(index, 0)
        return b"\r\n".join(lines)
    except poplib.error_proto:
        _resp, lines, _octets = conn.retr(index)
        raw = b"\r\n".join(lines)
        return raw.split(b"\r\n\r\n", 1)[0]


def parse_indices(raw_indices: Sequence[bytes]) -> list[tuple[int, int]]:
    """把 POP3 LIST 响应解析成 [(序号, 字节数)]。"""
    result: list[tuple[int, int]] = []
    for line in raw_indices:
        parts = line.decode("ascii", "replace").split()
        if len(parts) >= 2 and parts[0].isdigit():
            result.append((int(parts[0]), int(parts[1])))
    return result


def save_message(raw: bytes, msg, save_dir: Path, index: int) -> Path:
    save_dir.mkdir(parents=True, exist_ok=True)
    subject = decode_header_value(msg.get("Subject")) or "no-subject"
    safe = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in subject)[:60]
    path = save_dir / f"{index:05d}-{safe}.eml"
    path.write_bytes(raw)
    return path


def cmd_list(cfg: Config, args: argparse.Namespace) -> int:
    with connect_pop3(cfg, debug=args.debug) as conn:
        count, total_bytes = conn.stat()
        entries = parse_indices(conn.list()[1])
        if args.limit and args.limit > 0:
            entries = entries[-args.limit :]
        print(f"# {cfg.pop3_host}:{cfg.pop3_port} 共 {count} 封，{total_bytes / 1024:.1f} KB")
        for index, size in entries:
            try:
                header_msg = parse_message(fetch_headers(conn, index))
                print(f"{index:>4}  {size:>8} B  {message_summary(header_msg)}")
            except poplib.error_proto as exc:
                print(f"{index:>4}  {size:>8} B  (头部读取失败: {exc})")
    return EXIT_OK


def select_indices(conn, args: argparse.Namespace) -> list[int]:
    count, _ = conn.stat()
    if args.index is not None:
        indices = [int(i) for i in args.index]
    elif args.last:
        indices = list(range(max(1, count - args.last + 1), count + 1))
    else:
        raise UsageError("请指定 --index N 或 --last N")
    for index in indices:
        if not 1 <= index <= count:
            raise UsageError(f"序号 {index} 超出范围（当前共 {count} 封）")
    return indices


def cmd_fetch(cfg: Config, args: argparse.Namespace) -> int:
    save_dir = Path(args.save_dir) if args.save_dir else None
    with connect_pop3(cfg, debug=args.debug) as conn:
        for index in select_indices(conn, args):
            _resp, lines, _octets = conn.retr(index)
            raw = b"\r\n".join(lines)
            msg = parse_message(raw)
            print(f"--- #{index} ---")
            print(message_summary(msg))
            try:
                body = msg.get_body(preferencelist=("plain", "html"))
            except Exception:  # 畸形邮件兜底
                body = None
            if body is not None:
                try:
                    text = str(body.get_content())
                except Exception:
                    payload = body.get_payload(decode=True) or b""
                    text = payload.decode("utf-8", "replace")
                print(text if len(text) < 4000 else text[:4000] + "\n…(已截断)")
            if save_dir is not None:
                print(f"已保存: {save_message(raw, msg, save_dir, index)}")
            if args.delete:
                conn.dele(index)
                log(f"已标记删除 #{index}（QUIT 后生效）", quiet=args.quiet)
    return EXIT_OK


def cmd_delete(cfg: Config, args: argparse.Namespace) -> int:
    with connect_pop3(cfg, debug=args.debug) as conn:
        indices = [int(i) for i in args.index]
        for index in indices:
            conn.dele(index)
            log(f"已标记删除 #{index}（QUIT 后生效）", quiet=args.quiet)
    return EXIT_OK


# --------------------------------------------------------------------------- #
# check / init-env
# --------------------------------------------------------------------------- #
def cmd_check(cfg: Config, args: argparse.Namespace) -> int:
    ok = True

    log(f"[1/2] SMTP {cfg.smtp_host}:{cfg.smtp_port}（{cfg.smtp_security}，AUTH {cfg.smtp_auth}）…", quiet=args.quiet)
    try:
        with open_authenticated_smtp(cfg, debug=args.debug, quiet=args.quiet) as server:
            log(f"      OK 登录成功，服务器能力: {', '.join(server.esmtp_features)[:120] or '(无)'}", quiet=args.quiet)
    except smtplib.SMTPAuthenticationError as exc:
        ok = False
        log(f"      FAIL 鉴权失败：{exc.smtp_code} {exc.smtp_error!r}", quiet=args.quiet)
    except MailAuthError as exc:
        ok = False
        log(f"      FAIL 鉴权失败：{exc}", quiet=args.quiet)
    except (smtplib.SMTPException, OSError, ssl.SSLError) as exc:
        ok = False
        log(f"      FAIL {type(exc).__name__}: {exc}", quiet=args.quiet)

    log(f"[2/2] POP3 {cfg.pop3_host}:{cfg.pop3_port}（{cfg.pop3_security}）…", quiet=args.quiet)
    try:
        with connect_pop3(cfg, debug=args.debug) as conn:
            count, total = conn.stat()
            log(f"      OK 登录成功，收件箱 {count} 封 / {total / 1024:.1f} KB", quiet=args.quiet)
    except MailAuthError as exc:
        ok = False
        log(f"      FAIL 鉴权失败：{exc}", quiet=args.quiet)
    except poplib.error_proto as exc:
        ok = False
        log(f"      FAIL 协议错误：{pop_error_text(exc)}", quiet=args.quiet)
    except (OSError, ssl.SSLError) as exc:
        ok = False
        log(f"      FAIL {type(exc).__name__}: {exc}", quiet=args.quiet)

    print("结果：全部通过" if ok else "结果：存在失败项，见上面日志")
    return EXIT_OK if ok else EXIT_AUTH


def cmd_init_env(args: argparse.Namespace) -> int:
    path = Path(args.env_file) if args.env_file else DEFAULT_ENV_PATH
    if path.exists() and not args.force:
        log(f"{path} 已存在，未覆盖（加 --force 可覆盖）")
        return EXIT_OK
    path.write_text(ENV_TEMPLATE, encoding="utf-8")
    log(f"已生成 {path}，请填入 MAIL_ADDRESS / MAIL_PASSWORD。")
    return EXIT_OK


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def _global_overrides() -> argparse.ArgumentParser:
    """可写在子命令前后的全局选项副本。

    默认值用 SUPPRESS：只有用户显式传入时才写入命名空间，从而不会覆盖主解析器已解析的值，
    这样 `mail_client.py --env-file x check` 与 `mail_client.py check --env-file x` 都可用。
    """
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--env-file", default=argparse.SUPPRESS, help="env 文件路径（默认脚本同目录 .env）")
    common.add_argument("--timeout", type=int, default=argparse.SUPPRESS, help="超时秒数，覆盖 .env 的 MAIL_TIMEOUT")
    common.add_argument("--insecure", action="store_true", default=argparse.SUPPRESS, help="跳过 TLS 证书校验")
    common.add_argument("--debug", action="store_true", default=argparse.SUPPRESS, help="打印协议级调试日志")
    common.add_argument("--quiet", action="store_true", default=argparse.SUPPRESS, help="只输出结果，不输出过程日志")
    return common


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mail_client.py",
        description="SMTP 发信 / POP3 收信（凭据从 .env 读取）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="示例:\n"
        "  python mail_client.py check\n"
        "  python mail_client.py send --to a@x.com --subject 测试 --body 你好\n"
        "  python mail_client.py list --limit 10\n"
        "  python mail_client.py fetch --last 1 --save-dir ./inbox\n"
        "  python mail_client.py check --env-file ./prod.env\n",
    )
    parser.add_argument("--env-file", default=str(DEFAULT_ENV_PATH), help="env 文件路径（默认脚本同目录 .env）")
    parser.add_argument("--timeout", type=int, default=None, help="超时秒数，覆盖 .env 的 MAIL_TIMEOUT")
    parser.add_argument("--insecure", action="store_true", help="跳过 TLS 证书校验（自签证书时使用）")
    parser.add_argument("--debug", action="store_true", help="打印协议级调试日志")
    parser.add_argument("--quiet", action="store_true", help="只输出结果，不输出过程日志")

    common = _global_overrides()
    sub = parser.add_subparsers(dest="command", required=True)

    def add_server_args(p: argparse.ArgumentParser) -> None:
        p.add_argument("--smtp-host", help="覆盖 SMTP 主机")
        p.add_argument("--smtp-port", type=int, help="覆盖 SMTP 端口")
        p.add_argument("--smtp-security", choices=["auto", "none", "starttls", "ssl"], help="覆盖 SMTP 加密方式")
        p.add_argument("--smtp-auth", choices=["auto", "login", "plain", "none"], help="覆盖 SMTP 认证机制")
        p.add_argument("--pop3-host", help="覆盖 POP3 主机")
        p.add_argument("--pop3-port", type=int, help="覆盖 POP3 端口")
        p.add_argument("--pop3-security", choices=["auto", "none", "stls", "ssl"], help="覆盖 POP3 加密方式")

    p_send = sub.add_parser("send", help="发送邮件", parents=[common])
    p_send.add_argument("--to", action="append", required=True, help="收件人，可逗号分隔或重复传入")
    p_send.add_argument("--cc", action="append", help="抄送")
    p_send.add_argument("--bcc", action="append", help="密送")
    p_send.add_argument("--subject", default="", help="主题")
    p_send.add_argument("--body", help="正文文本；缺省读 --body-file 或标准输入")
    p_send.add_argument("--body-file", help="从文件读取正文（UTF-8）")
    p_send.add_argument("--html", action="store_true", help="正文按 HTML 发送（同时带纯文本兜底）")
    p_send.add_argument("--attach", action="append", help="附件路径，可重复")
    p_send.add_argument("--sender", help="发件地址，默认 MAIL_ADDRESS")
    p_send.add_argument("--reply-to", help="Reply-To 地址")
    p_send.add_argument("--dry-run", action="store_true", help="只打印邮件内容，不真正发送")
    add_server_args(p_send)
    p_send.set_defaults(func=cmd_send)

    p_list = sub.add_parser("list", help="列出收件箱（只取头部）", parents=[common])
    p_list.add_argument("--limit", type=int, default=20, help="只看最近 N 封，0 表示全部")
    add_server_args(p_list)
    p_list.set_defaults(func=cmd_list)

    p_fetch = sub.add_parser("fetch", help="下载/查看邮件正文", parents=[common])
    p_fetch.add_argument("--index", action="append", help="邮件序号，可重复")
    p_fetch.add_argument("--last", type=int, help="最近 N 封")
    p_fetch.add_argument("--save-dir", help="把原始邮件保存为 .eml 的目录")
    p_fetch.add_argument("--delete", action="store_true", help="下载后从服务器删除")
    add_server_args(p_fetch)
    p_fetch.set_defaults(func=cmd_fetch)

    p_del = sub.add_parser("delete", help="按序号删除邮件", parents=[common])
    p_del.add_argument("--index", action="append", required=True, help="邮件序号，可重复")
    add_server_args(p_del)
    p_del.set_defaults(func=cmd_delete)

    p_check = sub.add_parser("check", help="校验发件/收件服务器连通与账号密码", parents=[common])
    add_server_args(p_check)
    p_check.set_defaults(func=cmd_check)

    p_init = sub.add_parser("init-env", help="生成 .env 模板", parents=[common])
    p_init.add_argument("--force", action="store_true", help="覆盖已存在的文件")
    p_init.set_defaults(func=cmd_init_env)

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.command == "init-env":
        return cmd_init_env(args)

    env_path = Path(args.env_file)
    try:
        cfg = load_config(env_path, args)
    except FileNotFoundError:
        log(f"未找到环境文件：{env_path}\n可执行 `python {Path(__file__).name} init-env` 生成模板。")
        return EXIT_CONFIG
    except ValueError as exc:
        log(f"配置错误：{exc}")
        return EXIT_CONFIG
    if args.timeout:
        cfg.timeout = args.timeout

    try:
        return args.func(cfg, args)
    except KeyboardInterrupt:
        log("已中断")
        return EXIT_USAGE
    except UsageError as exc:
        log(f"用法错误：{exc}")
        return EXIT_USAGE
    except MailAuthError as exc:
        log(f"鉴权失败：{exc}")
        return EXIT_AUTH
    except poplib.error_proto as exc:
        log(f"POP3 协议错误：{pop_error_text(exc)}")
        return EXIT_MAIL
    except (smtplib.SMTPException, OSError, ssl.SSLError) as exc:
        log(f"失败：{type(exc).__name__}: {exc}")
        return EXIT_CONN


if __name__ == "__main__":
    sys.exit(main())
