#!/usr/bin/env python3
"""Run MyAtlas from a checkout: python3 tools/MyAtlas/myatlas.py --root . check"""

import sys

from myatlas.cli import main

sys.exit(main())
