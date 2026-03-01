#!/opt/backups/venv/bin/python3
import sys
from wsgiref.handlers import CGIHandler

sys.path.insert(0, '/opt/backups/lib')
from whm_plugin import app  # pylint: disable=wrong-import-position

if __name__ == '__main__':
    CGIHandler().run(app)