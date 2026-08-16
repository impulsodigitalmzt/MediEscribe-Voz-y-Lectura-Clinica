#!/bin/bash
# Render build script for MedScribe backend
# Run this as the Build Command in Render dashboard:
#   chmod +x render_build.sh && ./render_build.sh

set -e
pip install -r requirements.txt

# Download spaCy base English model (required by medspaCy)
python -m spacy download en_core_web_sm

echo "Build complete."
