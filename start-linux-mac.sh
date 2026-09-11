#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then echo "Node.js 22+ is required."; exit 1; fi
if [ ! -f node_modules/express/package.json ]; then npm install; fi
npm start
