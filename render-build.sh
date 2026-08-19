#!/usr/bin/env bash
set -eu

DEFAULT_CATALOG_URL="https://la-goutte-de-mer-paiements.onrender.com/api/catalog/source.csv"
CATALOG_URL="${CATALOG_SOURCE_URL:-$DEFAULT_CATALOG_URL}"
ESCAPED_CATALOG_URL=$(printf "%s" "$CATALOG_URL" | sed "s/'/'\\\\''/g")

cat > assets/js/render-runtime-config.js <<EOF
window.RENDER_RUNTIME_CONFIG = {
    catalogSourceUrl: '$ESCAPED_CATALOG_URL'
};

window.PRODUCTS_SOURCE_URL = window.RENDER_RUNTIME_CONFIG.catalogSourceUrl;
EOF
