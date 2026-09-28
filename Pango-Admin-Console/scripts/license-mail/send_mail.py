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
            refused_addresses = {address.casefold() for address in refused}
            if any(address.casefold() not in refused_addresses for address in [to, *cc]):
                return {'state': 'unknown', 'detail': '部分收件人被拒绝，其他收件人可能已收信；请核查主收件人及抄送人，不会自动重发'}
            return {'state': 'failed', 'detail': '所有收件人被邮件服务拒绝'}
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
