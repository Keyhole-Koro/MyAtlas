#!/bin/sh
# Serves the lab at http://localhost:8765/ (or the port given). Open the gallery there.
cd "$(dirname "$0")" && exec python3 -m http.server "${1:-8765}" --bind 127.0.0.1
