import base64
import smtplib
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'license-mail'))
import send_mail

class TransportTests(unittest.TestCase):
    def test_documented_none_security_setting(self):
        self.assertEqual(send_mail.mail_client.resolve_security('none', 25, False), 'none')
    def setUp(self):
        self.cfg = SimpleNamespace(address='service@example.com', display_name='Pango')
        self.payload = dict(to='customer@example.com', replyTo='fae@example.com', subject='测试', messageId='<test@example.com>', text='正文', attachments=[dict(name='new_pds_123456789abc.lic',base64=base64.b64encode(b'license bytes').decode())])

    def test_attachment_and_only_customer_recipient(self):
        parent=self
        class SMTP:
            def send_message(self, message, **kwargs):
                parent.assertEqual(kwargs['to_addrs'], ['customer@example.com'])
                parent.assertEqual(message['Reply-To'],'fae@example.com')
                parent.assertEqual(next(message.iter_attachments()).get_payload(decode=True), b'license bytes')
                return {}
            def quit(self):
                raise OSError('QUIT failed after acceptance')
            def close(self):
                pass
        self.assertEqual(send_mail.dispatch(self.cfg,self.payload,lambda *a,**k:SMTP())['state'],'accepted')

    def test_failures_are_classified_before_or_during_data(self):
        def connection_failure(*a,**k):
            raise OSError('unreachable')
        self.assertEqual(send_mail.dispatch(self.cfg,self.payload,connection_failure)['state'],'failed')
        for error,state in [(smtplib.SMTPDataError(550,b'no'),'failed'),(smtplib.SMTPRecipientsRefused({'customer@example.com':(550,b'no')}),'failed'),(TimeoutError('lost acknowledgement'),'unknown')]:
            class SMTP:
                def send_message(self,*a,**k):
                    raise error
                def quit(self):
                    pass
            self.assertEqual(send_mail.dispatch(self.cfg,self.payload,lambda *a,**k:SMTP())['state'],state)

    def test_header_injection_never_connects(self):
        def unexpected(*a,**k):
            self.fail('must not open SMTP')
        self.payload['to']='customer@example.com\nBcc: other@example.com'
        self.assertEqual(send_mail.dispatch(self.cfg,self.payload,unexpected)['state'],'failed')

    def test_customer_mail_cannot_use_platform_from_address(self):
        self.payload['expectedFrom'] = 'fae@example.com'
        def unexpected(*a, **k):
            self.fail('sender mismatch must be rejected before SMTP connection')
        self.assertEqual(send_mail.dispatch(self.cfg, self.payload, unexpected)['state'], 'failed')
        self.cfg.address = 'fae@example.com'
        msg = send_mail.build_message(self.cfg, self.payload)
        self.assertIn('fae@example.com', msg['From'])
        self.assertNotIn('service@example.com', msg['From'])

    def test_platform_mail_cannot_use_fae_from_address(self):
        self.payload['forbiddenFrom'] = 'service@example.com'
        def unexpected(*a, **k):
            self.fail('platform must use a separate account')
        self.assertEqual(send_mail.dispatch(self.cfg, self.payload, unexpected)['state'], 'failed')

if __name__ == '__main__':
    unittest.main()
