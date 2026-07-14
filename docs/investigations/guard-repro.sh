#!/usr/bin/env bash
# Mirrors the "Skip already published version" step from .github/workflows/publish.yml
# Pure read (npm view). Never invokes npm publish.
set -uo pipefail
name="${1:?pkg name}"
version="${2:?version}"
echo "--- guard('$name', '$version') ---"
output=$(npm view "${name}@${version}" version 2>&1)
status=$?
if [ "$status" -eq 0 ]; then
  echo "branch=ALREADY_PUBLISHED (status=0) -> sets skip=true"
  echo "npm view stdout: ${output}"
elif printf '%s' "$output" | grep -Eq 'E404|404 Not Found'; then
  echo "branch=NOT_FOUND (E404 match) -> sets skip=false (PROCEEDS TO PUBLISH)"
  echo "npm view stderr: ${output}"
else
  echo "branch=ERROR (unexpected) -> would exit $status"
  echo "npm view output: ${output}"
fi
