#!/usr/bin/env bash
set -eu

DEFAULT_CATALOG_URL="https://docs.google.com/spreadsheets/d/e/2PACX-1vT4yIHVQ_Zei5NVhGh2QiG-qp2MbMjMirLZocFA9g0f_MMMQl-K6oQgFlCjjL3NZS8oFGDz9kEroOGL/pub?gid=1960069975&single=true&output=csv"
CATALOG_URL="${CATALOG_SOURCE_URL:-$DEFAULT_CATALOG_URL}"
ESCAPED_CATALOG_URL=$(printf "%s" "$CATALOG_URL" | sed "s/'/'\\\\''/g")

cat > assets/js/render-runtime-config.js <<EOF
window.RENDER_RUNTIME_CONFIG = {
    catalogSourceUrl: '$ESCAPED_CATALOG_URL'
};

window.PRODUCTS_SOURCE_URL = window.RENDER_RUNTIME_CONFIG.catalogSourceUrl;
EOF
