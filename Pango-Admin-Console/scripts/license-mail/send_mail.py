#!/usr/bin/env python3
"""JSON stdin bridge. Never logs credentials or connects during import/tests."""
import argparse
import base64
import json
import re
import smtplib
import sys
from email.message import EmailMessage
from email.utils import formataddr, formatdate
from pathlib import Path

import mail_client


def recipients(payload):
    pattern = r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}"
    def valid(address):
        return isinstance(address, str) and len(address) <= 254 and re.fullmatch(pattern, address) is not None
    to = payload.get('to')
    raw = payload.get('cc', [])
    if not valid(to) or not isinstance(raw, list) or len(raw) > 10:
        raise ValueError('Invalid recipients')
    cc, seen = [], {to.casefold()}
    for address in raw:
        if not valid(address):
            raise ValueError('Invalid CC recipient')
        if address.casefold() not in seen:
            seen.add(address.casefold())
            cc.append(address)
    return to, cc


def build_message(cfg, payload):
    expected = payload.get('expectedFrom')
    forbidden = payload.get('forbiddenFrom')
    if expected and cfg.address.strip().casefold() != expected.strip().casefold():
        raise ValueError('FAE sender does not match LICENSE_FAE_EMAIL')
    if forbidden and cfg.address.strip().casefold() == forbidden.strip().casefold():
        raise ValueError('Platform mail must use a separate sender account')
    msg = EmailMessage()
    msg['From'] = formataddr((cfg.display_name, cfg.address)) if cfg.display_name else cfg.address
    to, cc = recipients(payload)
    msg['To'] = to
    if cc:
        msg['Cc'] = ', '.join(cc)
    msg['Subject'] = payload['subject']
    msg['Message-ID'] = payload['messageId']
    msg['Date'] = formatdate(localtime=False)
    if payload.get('replyTo'):
        msg['Reply-To'] = payload['replyTo']
    msg.set_content(payload['text'], charset='utf-8')
    if payload.get('html'):
        msg.add_alternative(payload['html'], subtype='html', charset='utf-8')
    images = payload.get('inlineImages', [])
    if images and not payload.get('html'):
        raise ValueError('Inline images require HTML')
    for image in images:
        if image.get('cid') != 'pango-company-logo' or image.get('mimeType') not in ('image/png', 'image/jpeg'):
            raise ValueError('Invalid inline logo')
        content = base64.b64decode(image['base64'], validate=True)
        if not content or len(content) > 256 * 1024:
            raise ValueError('Invalid logo size')
        msg.get_payload()[-1].add_related(content, maintype='image', subtype=image['mimeType'].split('/')[1], cid='<pango-company-logo>', disposition='inline')
    for item in payload.get('attachments', []):
        msg.add_attachment(base64.b64decode(item['base64'], validate=True), maintype='application', subtype='octet-stream', filename=item['name'])
    return msg


def recipient_failure(to, cc, refused, *, data_sent=True):
    """Only RCPT responses classify addresses; DATA/AUTH failures prove nothing about them."""
    responses = {str(addr).casefold(): reply for addr, reply in refused.items()}
    missing = [addr for addr in [to, *cc] if addr.casefold() not in responses]
    details = []
    for addr in [to, *cc]:
        if addr.casefold() not in responses:
            continue
        code, reason = responses[addr.casefold()]
        reason = reason.decode('ascii', errors='replace') if isinstance(reason, bytes) else str(reason)
        enhanced = re.match(r'^\s*([245]\.\d{1,3}\.\d{1,3})(?:\s|$)', reason)
        status = enhanced.group(1) if enhanced else ''
        note = '（目标邮箱不存在或无效）' if str(code).startswith('5') and status == '5.1.1' else ''
        # Only log known envelope addresses and protocol codes, never arbitrary server text.
        role = '主收件人' if addr == to else '抄送'
        details.append(f'{role} {addr}：SMTP {code} {status}'.rstrip() + note)
    if not details:
        return {'state': 'unknown' if data_sent else 'failed', 'detail': '收件人响应与发送名单不一致，请按 Message-ID 核查'}
    if missing and data_sent:
        return {'state': 'unknown', 'detail': '部分收件地址被拒收：' + '；'.join(details) + '；其他地址可能已收到，不自动重发'}
    return {'state': 'failed', 'detail': '收件地址被拒收：' + '；'.join(details)}


def dispatch(cfg, payload, opener=mail_client.open_authenticated_smtp):
    try:
        to, cc = recipients(payload)
        msg = build_message(cfg, payload)
        server = opener(cfg, quiet=True)
    except Exception as error:
        return {'state': 'failed', 'detail': f'发信准备或连接失败：{type(error).__name__}'}
    try:
        refused = server.send_message(msg, from_addr=cfg.address, to_addrs=[to, *cc])
        if refused:
            return recipient_failure(to, cc, refused)
        return {'state': 'accepted', 'detail': '邮件服务已接受'}
    except smtplib.SMTPRecipientsRefused as error:
        return recipient_failure(to, cc, error.recipients, data_sent=False)
    except (smtplib.SMTPSenderRefused, smtplib.SMTPDataError) as error:
        return {'state': 'failed', 'detail': f'邮件服务明确拒绝：{type(error).__name__}'}
    except Exception as error:
        return {'state': 'unknown', 'detail': f'发送结果不明，请核查 Message-ID：{type(error).__name__}'}
    finally:
        try:
            server.quit()
        except Exception:
            try:
                server.close()
            except Exception:
                pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--env')
    args = parser.parse_args()
    try:
        payload = json.load(sys.stdin)
        if payload.get('smtpConfig'):
            values = payload['smtpConfig']
            allowed = {'address', 'password', 'smtp_host', 'smtp_port', 'smtp_security', 'username', 'display_name'}
            if set(values) - allowed:
                raise ValueError('Unsupported SMTP setting')
            cfg = mail_client.Config(**values)
        else:
            if not args.env:
                raise ValueError('Missing SMTP configuration')
            cfg = mail_client.load_config(Path(args.env), argparse.Namespace(smtp_host=None, smtp_port=None, smtp_security=None, pop3_host=None, pop3_port=None, pop3_security=None, smtp_auth=None, timeout=None, insecure=False))
        if cfg.timeout > 45:
            cfg.timeout = 45
        result = dispatch(cfg, payload)
    except Exception as error:
        result = {'state': 'failed', 'detail': f'发信配置或输入错误：{type(error).__name__}'}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
