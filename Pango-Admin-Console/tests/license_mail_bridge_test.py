"""Subprocess contract with a local fake SMTP server. Never contacts a real mail host."""
import base64
import json
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
