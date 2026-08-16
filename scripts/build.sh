#!/bin/bash
# ============================================
# MedScribe Build Script
# Packages the project as a self-contained ZIP
# ============================================

set -e

VERSION="${1:-1.0}"
DATE=$(date +%Y-%m-%d)
FILENAME="medscribe-v${VERSION}-${DATE}.zip"
BUILD_DIR="/tmp/medscribe-build"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "========================================"
echo "MedScribe Build Script"
echo "Version: ${VERSION}"
echo "Date: ${DATE}"
echo "Output: ${FILENAME}"
echo "========================================"

# Clean previous build
rm -rf "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}"

# Copy project files (excluding build artifacts and secrets)
echo "Copying project files..."
rsync -av --progress "${PROJECT_ROOT}/" "${BUILD_DIR}/" \
  --exclude='node_modules' \
  --exclude='__pycache__' \
  --exclude='.env' \
  --exclude='*.db' \
  --exclude='*.sqlite3' \
  --exclude='.git' \
  --exclude='dist' \
  --exclude='build' \
  --exclude='venv' \
  --exclude='.venv' \
  --exclude='*.egg-info' \
  --exclude='htmlcov' \
  --exclude='.coverage' \
  --exclude='*.pyc' \
  --exclude='*.pyo' \
  --exclude='.DS_Store' \
  --exclude='Thumbs.db' \
  --exclude='*.log'

# Verify required files exist
echo "Verifying required files..."
REQUIRED_FILES=(
  "README.md"
  "CHANGELOG.md"
  "BUILD_NOTES.txt"
  ".gitignore"
  ".env.example"
  "backend/requirements.txt"
  "backend/app/main.py"
  "frontend/package.json"
  "frontend/src/App.tsx"
  ".github/workflows/ci.yml"
)

for f in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "${BUILD_DIR}/${f}" ]; then
    echo "ERROR: Missing required file: ${f}"
    exit 1
  fi
done
echo "All required files present."

# Create ZIP
echo "Creating ZIP archive..."
cd "${BUILD_DIR}"
zip -r "/tmp/${FILENAME}" . -x '.git/*'
cd -

# Move to output
mv "/tmp/${FILENAME}" "${PROJECT_ROOT}/${FILENAME}"

echo "========================================"
echo "BUILD COMPLETE"
echo "Output: ${PROJECT_ROOT}/${FILENAME}"
echo "Size: $(du -h "${PROJECT_ROOT}/${FILENAME}" | cut -f1)"
echo "========================================"
