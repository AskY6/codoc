#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

echo "==> Building workspace deps + local app..."
pnpm build --filter=@cobook/local...

echo "==> Linking @cobook/local globally..."
cd apps/local
pnpm link --global

echo "==> Done. $(codoc --help 2>/dev/null | head -1 || echo 'codoc linked')"
