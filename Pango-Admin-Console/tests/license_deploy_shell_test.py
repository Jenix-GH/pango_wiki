"""Exercise release switching with fake npm/PM2/Node; no SSH, MySQL or mail."""
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
import uuid


class DeploymentTest(unittest.TestCase):
    def run_deployment(self, scenario):
        with tempfile.TemporaryDirectory(prefix='pango-deploy-test-') as temporary:
            root = Path(temporary)
            target = root / 'admin'
            (target / 'config').mkdir(parents=True)
            original_config = 'PANGO_DB_PASSWORD=test-only\nLICENSE_SEND_ENABLED=false\n'
            (target / 'config/database.env').write_text(original_config)
            (target / 'old-version').write_text('old')
            payload = root / 'payload'
            payload.mkdir()
            (payload / 'new-version').write_text('new')
            release = 'test-' + uuid.uuid4().hex
            archive = Path('/tmp') / f'pango-admin-{release}.tar.gz'
            self.addCleanup(lambda: archive.unlink(missing_ok=True))
            with tarfile.open(archive, 'w:gz') as tar:
                tar.add(payload, arcname='.')
            commands = root / 'bin'
            commands.mkdir()
            fake = '''#!/usr/bin/env python3
import os, sys
from pathlib import Path
name = Path(sys.argv[0]).name
args = sys.argv[1:]
scenario = os.environ['DEPLOY_TEST_SCENARIO']
with open(os.environ['DEPLOY_TEST_LOG'], 'a') as log:
    log.write(name + ' ' + ' '.join(args) + '\\n')
if name == 'npm' and args == ['run', 'build'] and scenario == 'build-failure': sys.exit(1)
if name == 'node' and args and args[0].endswith('prepare-license-deploy.mjs'):
    if scenario == 'prepare-failure': sys.exit(1)
    config = Path(args[args.index('--config') + 1])
    config.write_text(config.read_text() + 'LICENSE_DELIVERY_ENABLED=true\\n')
if name == 'node' and 'health' in args and scenario == 'health-failure': sys.exit(1)
sys.exit(0)
'''
            for name in ['node', 'npm', 'pm2', 'flock']:
                path = commands / name
                path.write_text(fake)
                path.chmod(0o700)
            env = dict(os.environ, PATH=str(commands) + os.pathsep + os.environ['PATH'],
                       DEPLOY_TEST_SCENARIO=scenario, DEPLOY_TEST_LOG=str(root / 'commands.log'))
            script = Path(__file__).resolve().parents[1] / 'deploy/deploy-admin-console.sh'
            result = subprocess.run(['bash', str(script), str(target), 'pango_test', release], env=env, capture_output=True, text=True)
            backup = root / f'.pango-admin-backup-{release}'
            failed = root / f'.pango-admin-failed-{release}'
            if scenario == 'success':
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue((target / 'new-version').exists())
                self.assertTrue((backup / 'old-version').exists())
                self.assertEqual((backup / 'config/database.env').read_text(), original_config)
                self.assertIn('LICENSE_DELIVERY_ENABLED=true', (target / 'config/database.env').read_text())
            else:
                self.assertNotEqual(result.returncode, 0)
                self.assertTrue((target / 'old-version').exists())
                self.assertEqual((target / 'config/database.env').read_text(), original_config)
                self.assertEqual(failed.exists(), scenario == 'health-failure')
            self.assertFalse((root / f'.pango-admin-stage-{release}').exists())
            self.assertFalse(archive.exists())

    def test_success_keeps_backup(self):
        self.run_deployment('success')

    def test_health_failure_restores_code_and_config(self):
        self.run_deployment('health-failure')

    def test_preparation_failure_keeps_running_release(self):
        self.run_deployment('prepare-failure')

    def test_build_failure_keeps_running_release(self):
        self.run_deployment('build-failure')


if __name__ == '__main__':
    unittest.main()
