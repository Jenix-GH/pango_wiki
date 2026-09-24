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
    def handle(self):
        self.wfile.write(b'220 local fake smtp\r\n')
        data=False
        lines=[]
        while True:
            line=self.rfile.readline()
            if not line:
                break
            if data:
                if line==b'.\r\n':
                    self.accepted.append(b''.join(lines))
                    self.wfile.write(b'250 accepted\r\n');data=False
                else:
                    lines.append(line)
            elif line.upper().startswith((b'EHLO',b'HELO')):
                self.wfile.write(b'250-localhost\r\n250 AUTH PLAIN LOGIN\r\n')
            elif line.upper().startswith(b'AUTH'):
                self.wfile.write(b'235 authenticated\r\n')
            elif line.upper().startswith(b'DATA'):
                self.wfile.write(b'354 send message\r\n');data=True
            elif line.upper().startswith(b'QUIT'):
                self.wfile.write(b'221 bye\r\n');break
            else:
                self.wfile.write(b'250 ok\r\n')

class BridgeTests(unittest.TestCase):
    def setUp(self):
        SMTP.accepted = []

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

    def test_real_bridge_with_local_fake_smtp(self):
        with socketserver.TCPServer(('127.0.0.1',0),SMTP) as server, tempfile.TemporaryDirectory() as tmp:
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                config=Path(tmp)/'mail.env'
                config.write_text(f'MAIL_ADDRESS=service@example.com\nMAIL_PASSWORD=test-only\nSMTP_HOST=127.0.0.1\nSMTP_PORT={server.server_address[1]}\nSMTP_SECURITY=plain\nSMTP_AUTH=plain\n')
                payload={'to':'customer@example.com','subject':'License 测试','text':'测试正文','messageId':'<test@localhost>','attachments':[{'name':'new_pds_1a2b3c4d5f60.lic','base64':base64.b64encode(b'fixture-only').decode()}]}
                result=subprocess.run([sys.executable,str(Path(__file__).resolve().parents[1]/'scripts/license-mail/send_mail.py'),'--env',str(config)],input=json.dumps(payload),text=True,capture_output=True,timeout=15)
                self.assertEqual(result.returncode,0)
                self.assertEqual(json.loads(result.stdout)['state'],'accepted',result.stdout)
                self.assertEqual(len(SMTP.accepted),1)
                self.assertIn(b'To: customer@example.com',SMTP.accepted[0])
            finally:
                server.shutdown();thread.join()

if __name__=='__main__':
    unittest.main()
