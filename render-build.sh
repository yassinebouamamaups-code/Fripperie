#!/usr/bin/env bash
set -eu

DEFAULT_CATALOG_URL="https://docs.google.com/spreadsheets/d/1yZVWg-Ypzd2VtFE4tVf0XmVVvTqzgFu8TTq4KAyvsb0/export?format=csv&gid=1348794459"
CATALOG_URL="${CATALOG_SOURCE_URL:-$DEFAULT_CATALOG_URL}"
ESCAPED_CATALOG_URL=$(printf "%s" "$CATALOG_URL" | sed "s/'/'\\\\''/g")

cat > assets/js/render-runtime-config.js <<EOF
window.RENDER_RUNTIME_CONFIG = {
    catalogSourceUrl: '$ESCAPED_CATALOG_URL'
};

window.PRODUCTS_SOURCE_URL = window.RENDER_RUNTIME_CONFIG.catalogSourceUrl;
EOF
