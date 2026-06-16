#!/bin/bash
# setup.sh
# Downloads the @huggingface/transformers library into the lib/ folder.
# Run this ONCE from inside the meet-notetaker-extension folder:
#
#   bash setup.sh
#
# Requires Node.js + npm installed (download from nodejs.org if needed).

set -e

mkdir -p lib

echo "Downloading @huggingface/transformers..."
curl -L -o lib/transformers.min.js "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0/dist/transformers.min.js"

echo ""
echo "Done. lib/transformers.min.js has been downloaded."
echo "Now go to chrome://extensions and click 'Reload' on the extension."
