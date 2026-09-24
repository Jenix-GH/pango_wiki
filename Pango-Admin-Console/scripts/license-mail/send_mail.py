#!/usr/bin/env python3
"""JSON stdin bridge. Never logs credentials or connects during import/tests."""
import argparse
import base64
import json
import smtplib
import sys
from email.message import EmailMessage
from email.utils import formataddr, formatdate
from pathlib import Path

import mail_client


def build_message(cfg, payload):
    expected = payload.get('expectedFrom')
    forbidden = payload.get('forbiddenFrom')
    if expected and cfg.address.strip().casefold() != expected.strip().casefold():
        raise ValueError('FAE sender does not match LICENSE_FAE_EMAIL')
    if forbidden and cfg.address.strip().casefold() == forbidden.strip().casefold():
        raise ValueError('Platform mail must use a separate sender account')
    msg = EmailMessage()
    msg['From'] = formataddr((cfg.display_name, cfg.address)) if cfg.display_name else cfg.address
    msg['To'] = payload['to']
    msg['Subject'] = payload['subject']
    msg['Message-ID'] = payload['messageId']
    msg['Date'] = formatdate(localtime=False)
    if payload.get('replyTo'):
        msg['Reply-To'] = payload['replyTo']
    msg.set_content(payload['text'], charset='utf-8')
    for item in payload.get('attachments', []):
        msg.add_attachment(base64.b64decode(item['base64'], validate=True), maintype='application', subtype='octet-stream', filename=item['name'])
    return msg


def dispatch(cfg, payload, opener=mail_client.open_authenticated_smtp):
    try:
        msg = build_message(cfg, payload)
        server = opener(cfg, quiet=True)
    except Exception as error:
        return {'state': 'failed', 'detail': f'发信准备或连接失败：{type(error).__name__}'}
    try:
        refused = server.send_message(msg, from_addr=cfg.address, to_addrs=[payload['to']])
        if refused:
            return {'state': 'failed', 'detail': '收件人被邮件服务拒绝'}
        return {'state': 'accepted', 'detail': '邮件服务已接受'}
    except (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused, smtplib.SMTPDataError) as error:
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
