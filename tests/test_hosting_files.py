"""Tracked container files must not publish the unauthenticated dashboard beyond loopback."""

from pathlib import Path
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[1]


class ComposePublishingTests(unittest.TestCase):
    def test_every_compose_port_binds_host_loopback(self):
        files = sorted(ROOT.glob('docker-compose*.yml'))
        self.assertEqual([path.name for path in files], ['docker-compose.debug.yml', 'docker-compose.yml'])
        for path in files:
            services = yaml.safe_load(path.read_text(encoding='utf-8'))['services']
            for name, service in services.items():
                self.assertTrue(service.get('ports'))
                for port in service['ports']:
                    with self.subTest(file=path.name, service=name, port=port):
                        # No host IP publishes on every interface. Quote mappings: some
                        # unquoted ones, such as 22:22, parse as YAML 1.1 base-60 numbers.
                        self.assertIsInstance(port, str)
                        self.assertTrue(port.startswith('127.0.0.1:'))
