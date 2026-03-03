#!/usr/bin/env bash
set -euo pipefail

# steps to build the front end and copy it into the python package directory for publishing

cd "$(dirname "$0")"

echo "Installing frontend dependencies..."
npm ci

echo "Building frontend..."
npx vite build

echo "Frontend built into river_route_app/static/"
cp -R dist/* river_route_app/static/
