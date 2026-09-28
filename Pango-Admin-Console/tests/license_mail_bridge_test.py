"""Subprocess contract with a local fake SMTP server. Never contacts a real mail host."""
import base64
import json
import os
from email import policy
from email.parser import BytesParser
import socketserver
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path

class SMTP(socketserver.StreamRequestHandler):
    accepted=[]
    envelopes=[]
    def handle(self):
        self.wfile.write(b'220 local fake smtp\r\n')
        data=False
        lines=[]
        recipients=[]
        while True:
            line=self.rfile.readline()
            if not line:
                break
            if data:
                if line==b'.\r\n':
                    self.accepted.append(b''.join(lines))
                    self.envelopes.append(list(recipients))
                    self.wfile.write(b'250 accepted\r\n');data=False
                else:
                    lines.append(line)
            elif line.upper().startswith((b'EHLO',b'HELO')):
                self.wfile.write(b'250-localhost\r\n250 AUTH PLAIN LOGIN\r\n')
            elif line.upper().startswith(b'AUTH'):
                self.wfile.write(b'235 authenticated\r\n')
            elif line.upper().startswith(b'RCPT TO:'):
                recipients.append(line.split(b':',1)[1].strip().strip(b'<>').decode())
                self.wfile.write(b'250 ok\r\n')
            elif line.upper().startswith(b'DATA'):
                self.wfile.write(b'354 send message\r\n');data=True
            elif line.upper().startswith(b'QUIT'):
                self.wfile.write(b'221 bye\r\n');break
            else:
                self.wfile.write(b'250 ok\r\n')

class BridgeTests(unittest.TestCase):
    def setUp(self):
        SMTP.accepted = []
        SMTP.envelopes = []

    def test_node_routes_real_subprocesses_to_separate_accounts(self):
        with socketserver.TCPServer(('127.0.0.1', 0), SMTP) as server, tempfile.TemporaryDirectory() as tmp:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                platform, fae = Path(tmp) / 'platform.env', Path(tmp) / 'fae.env'
                for path, address in [(platform, 'platform@example.com'), (fae, 'fae@example.com')]:
                    path.write_text(f'MAIL_ADDRESS={address}\nMAIL_PASSWORD=test-only\nSMTP_HOST=127.0.0.1\nSMTP_PORT={server.server_address[1]}\nSMTP_SECURITY=plain\nSMTP_AUTH=plain\n')
                module = (Path(__file__).resolve().parents[1] / 'licenseMail.mjs').as_uri()
                config = dict(LICENSE_MAIL_ENV=str(platform), LICENSE_FAE_MAIL_ENV=str(fae), LICENSE_FAE_EMAIL='fae@example.com', LICENSE_PYTHON=sys.executable)
                code = f"""
import {{createWorkflowMailSender}} from {json.dumps(module)};
const sender=createWorkflowMailSender({json.dumps(config)},{{testRecipient:'tester@example.com'}});
for(const mailKind of ['digest','summary','customer','rejection']){{
 const result=await sender({{mailKind,to:'tester@example.com',subject:'fixture',text:'test only',messageId:'<'+mailKind+'@localhost>',attachments:[]}});
 if(result.state!=='accepted')throw new Error(JSON.stringify(result));
}}
const inlineConfig={json.dumps(config)};
inlineConfig.LICENSE_FAE_SMTP={{address:'fae@example.com',password:'test-only',smtp_host:'127.0.0.1',smtp_port:{server.server_address[1]},smtp_security:'none',username:'',display_name:''}};
delete inlineConfig.LICENSE_FAE_MAIL_ENV;
const inlineSender=createWorkflowMailSender(inlineConfig,{{testRecipient:'tester@example.com'}});
const inlineResult=await inlineSender({{mailKind:'customer',to:'tester@example.com',subject:'inline fixture',text:'test only',messageId:'<inline@localhost>',attachments:[]}});
if(inlineResult.state!=='accepted')throw new Error(JSON.stringify(inlineResult));
"""
                env = dict(os.environ, MAIL_ADDRESS='inherited-platform@example.com', MAIL_PASSWORD='bad-inherited-secret', SMTP_HOST='invalid.example')
                result = subprocess.run(['node', '--input-type=module', '-e', code], capture_output=True, text=True, timeout=30, env=env)
                self.assertEqual(result.returncode, 0, result.stderr)
                messages = [BytesParser(policy=policy.default).parsebytes(raw) for raw in SMTP.accepted]
                self.assertEqual([str(msg['From']) for msg in messages], ['platform@example.com', 'platform@example.com', 'fae@example.com', 'fae@example.com', 'fae@example.com'])
                self.assertTrue(all(str(msg['To']) == 'tester@example.com' and msg['Cc'] is None and msg['Bcc'] is None for msg in messages))
            finally:
                server.shutdown()
                thread.join()

    def test_customer_and_rejection_cc_are_real_smtp_recipients(self):
        with socketserver.TCPServer(('127.0.0.1', 0), SMTP) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                root = Path(__file__).resolve().parents[1]
                config = dict(LICENSE_FAE_EMAIL='fae@example.com', LICENSE_PYTHON=sys.executable, LICENSE_FAE_SMTP=dict(address='fae@example.com', password='test-only', smtp_host='127.0.0.1', smtp_port=server.server_address[1], smtp_security='none', username='', display_name=''))
                code = f"""
import {{createWorkflowMailSender}} from {json.dumps((root/'licenseMail.mjs').as_uri())};
const sender=createWorkflowMailSender({json.dumps(config)});
for(const mailKind of ['customer','rejection']){{
 const result=await sender({{mailKind,to:'customer@example.com',cc:['copy1@example.com','copy2@example.com'],subject:'CC test',text:'same body',messageId:'<'+mailKind+'-cc@localhost>',attachments:mailKind==='customer'?[{{name:'test.lic',base64:'bGljZW5zZQ=='}}]:[]}});
 if(result.state!=='accepted')throw new Error(JSON.stringify(result));
}}
"""
                result = subprocess.run(['node', '--input-type=module', '-e', code], capture_output=True, text=True, timeout=20)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(SMTP.envelopes, [['customer@example.com','copy1@example.com','copy2@example.com']] * 2)
                messages = [BytesParser(policy=policy.default).parsebytes(raw) for raw in SMTP.accepted]
                self.assertTrue(all(str(m['From']) == 'fae@example.com' and str(m['Cc']) == 'copy1@example.com, copy2@example.com' for m in messages))
                self.assertEqual(next(messages[0].iter_attachments()).get_payload(decode=True), b'license')
                self.assertEqual(len(list(messages[1].iter_attachments())), 0)
            finally:
                server.shutdown()
                thread.join()

    def test_fae_digest_html_survives_real_node_python_smtp_bridge(self):
        with socketserver.TCPServer(('127.0.0.1', 0), SMTP) as server, tempfile.TemporaryDirectory() as tmp:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                env_file = Path(tmp) / 'platform.env'
                env_file.write_text(f'MAIL_ADDRESS=platform@example.com\nMAIL_PASSWORD=test-only\nSMTP_HOST=127.0.0.1\nSMTP_PORT={server.server_address[1]}\nSMTP_SECURITY=none\nSMTP_AUTH=plain\n')
                root = Path(__file__).resolve().parents[1]
                config = dict(LICENSE_MAIL_ENV=str(env_file), LICENSE_FAE_EMAIL='fae@example.com', LICENSE_PYTHON=sys.executable)
                code = f"""
import {{createWorkflowMailSender}} from {json.dumps((root/'licenseMail.mjs').as_uri())};
import {{digestMessage}} from {json.dumps((root/'licenseDelivery.mjs').as_uri())};
import {{applyMailTemplate}} from {json.dumps((root/'licenseMailTemplates.mjs').as_uri())};
const message=applyMailTemplate(digestMessage([{{id:39,applicant_name:'张三 <测试>',company_name:'测试学校',official_submitted:1,email:'customer@example.com'}}],[],'2026-09-28','fae@example.com'),'digest',{{digest:{{subject:'待办',text:'请审批\\n{{{{原始正文}}}}'}}}});
const result=await createWorkflowMailSender({json.dumps(config)})({{...message,mailKind:'digest',messageId:'<table-test@localhost>'}});
if(result.state!=='accepted')throw new Error(JSON.stringify(result));
"""
                result = subprocess.run(['node', '--input-type=module', '-e', code], capture_output=True, text=True, timeout=20)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(len(SMTP.accepted), 1)
                msg = BytesParser(policy=policy.default).parsebytes(SMTP.accepted[0])
                self.assertEqual(str(msg['From']), 'platform@example.com')
                self.assertEqual(str(msg['To']), 'fae@example.com')
                html = msg.get_body(preferencelist=('html',)).get_content()
                self.assertIn('<table ', html)
                self.assertIn('是否已在官网提交', html)
                self.assertIn('张三 &lt;测试&gt;', html)
                self.assertTrue(html.startswith('请审批<br>'))
                self.assertIn('张三 <测试>', msg.get_body(preferencelist=('plain',)).get_content())
                attachments = list(msg.iter_attachments())
                self.assertEqual(len(attachments), 1)
                self.assertTrue(attachments[0].get_filename().endswith('.csv'))
                self.assertIn('是否已在官网提交', attachments[0].get_payload(decode=True).decode('utf-8'))
            finally:
                server.shutdown()
                thread.join()

    def test_real_bridge_with_local_fake_smtp(self):
        with socketserver.TCPServer(('127.0.0.1',0),SMTP) as server, tempfile.TemporaryDirectory() as tmp:
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                config=Path(tmp)/'mail.env'
                config.write_text(f'MAIL_ADDRESS=service@example.com\nMAIL_PASSWORD=test-only\nSMTP_HOST=127.0.0.1\nSMTP_PORT={server.server_address[1]}\nSMTP_SECURITY=plain\nSMTP_AUTH=plain\n')
                payload={'to':'customer@example.com','subject':'License 测试','text':'测试正文','html':'<img src="cid:pango-company-logo"><p>测试正文</p>','inlineImages':[{'cid':'pango-company-logo','mimeType':'image/png','base64':base64.b64encode(b'inline test bytes').decode()}],'messageId':'<test@localhost>','attachments':[{'name':'new_pds_1a2b3c4d5f60.lic','base64':base64.b64encode(b'fixture-only').decode()}]}
                result=subprocess.run([sys.executable,str(Path(__file__).resolve().parents[1]/'scripts/license-mail/send_mail.py'),'--env',str(config)],input=json.dumps(payload),text=True,capture_output=True,timeout=15)
                self.assertEqual(result.returncode,0)
                self.assertEqual(json.loads(result.stdout)['state'],'accepted',result.stdout)
                self.assertEqual(len(SMTP.accepted),1)
                self.assertIn(b'To: customer@example.com',SMTP.accepted[0])
                parsed = BytesParser(policy=policy.default).parsebytes(SMTP.accepted[0])
                inline = [part for part in parsed.walk() if part.get('Content-ID') == '<pango-company-logo>']
                self.assertEqual(len(inline), 1)
                self.assertEqual(inline[0].get_payload(decode=True), b'inline test bytes')
                self.assertEqual(len(list(parsed.iter_attachments())), 1)
            finally:
                server.shutdown();thread.join()

if __name__=='__main__':
    unittest.main()
