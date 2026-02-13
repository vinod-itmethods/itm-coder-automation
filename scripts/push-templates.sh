#!/bin/bash
set -euo pipefail

# Push Coder templates via API
CODER_URL="${CODER_URL:-https://labcoder.stage.0658b-techopscore.com}"
CODER_TOKEN="${CODER_TOKEN:-dQLESldgyL-KesslmDtMi1L7Ks5Qt9Yqu}"
ORG="default"
TEMPLATES_DIR="$(cd "$(dirname "$0")/../coder-templates" && pwd)"

push_template() {
  local dir="$1"
  local name="$2"
  local display_name="$3"
  local description="$4"
  local icon="$5"

  echo "=== Pushing template: $name ==="

  # Create tar.gz of the template directory
  local tarfile="/tmp/coder-template-${name}.tar"
  tar -cf "$tarfile" -C "$dir" .

  # Upload file
  echo "  Uploading files..."
  local file_response
  file_response=$(curl -s -X POST \
    -H "Coder-Session-Token: $CODER_TOKEN" \
    -H "Content-Type: application/x-tar" \
    --data-binary "@$tarfile" \
    "${CODER_URL}/api/v2/files")

  local file_hash
  file_hash=$(echo "$file_response" | python3 -c "import sys,json; print(json.load(sys.stdin)['hash'])" 2>/dev/null)

  if [ -z "$file_hash" ]; then
    echo "  ERROR: Failed to upload files: $file_response"
    return 1
  fi
  echo "  File hash: $file_hash"

  # Check if template exists
  local existing
  existing=$(curl -s -H "Coder-Session-Token: $CODER_TOKEN" \
    "${CODER_URL}/api/v2/organizations/${ORG}/templates/${name}" 2>/dev/null)

  local template_id
  template_id=$(echo "$existing" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")

  if [ -n "$template_id" ] && [ "$template_id" != "" ]; then
    # Update existing template - create new version
    echo "  Template exists ($template_id), creating new version..."
    local version_response
    version_response=$(curl -s -X POST \
      -H "Coder-Session-Token: $CODER_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"file_id\": \"$file_hash\", \"template_id\": \"$template_id\", \"storage_method\": \"file\", \"provisioner\": \"terraform\", \"tags\": {\"scope\": \"organization\"}}" \
      "${CODER_URL}/api/v2/organizations/${ORG}/templateversions")

    local version_id
    version_id=$(echo "$version_response" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
    echo "  Version: $version_id (linked to template $template_id)"

    # Wait for provisioner
    echo "  Waiting for provisioner..."
    for i in $(seq 1 30); do
      local vstatus
      vstatus=$(curl -s -H "Coder-Session-Token: $CODER_TOKEN" \
        "${CODER_URL}/api/v2/templateversions/${version_id}" | \
        python3 -c "import sys,json; print(json.load(sys.stdin)['job']['status'])")

      if [ "$vstatus" = "succeeded" ]; then
        echo "  Provisioner succeeded"
        break
      elif [ "$vstatus" = "failed" ]; then
        echo "  ERROR: Provisioner failed"
        return 1
      fi
      sleep 2
    done

    # Promote version to active (uses /versions endpoint, not PATCH on template)
    local promote_response
    promote_response=$(curl -s -X PATCH \
      -H "Coder-Session-Token: $CODER_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"id\": \"$version_id\"}" \
      "${CODER_URL}/api/v2/templates/${template_id}/versions")

    if echo "$promote_response" | grep -q "Updated the active template version"; then
      echo "  Activated version $version_id"
    else
      echo "  WARNING: Promote response: $promote_response"
    fi
  else
    # Create new template
    echo "  Creating template version..."
    local version_response
    version_response=$(curl -s -X POST \
      -H "Coder-Session-Token: $CODER_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"file_id\": \"$file_hash\", \"storage_method\": \"file\", \"provisioner\": \"terraform\", \"tags\": {\"scope\": \"organization\"}}" \
      "${CODER_URL}/api/v2/organizations/${ORG}/templateversions")

    local version_id
    version_id=$(echo "$version_response" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
    echo "  Version: $version_id"

    # Wait for provisioner
    echo "  Waiting for provisioner..."
    for i in $(seq 1 30); do
      local status
      status=$(curl -s -H "Coder-Session-Token: $CODER_TOKEN" \
        "${CODER_URL}/api/v2/templateversions/${version_id}" | \
        python3 -c "import sys,json; print(json.load(sys.stdin)['job']['status'])")

      if [ "$status" = "succeeded" ]; then
        echo "  Provisioner succeeded"
        break
      elif [ "$status" = "failed" ]; then
        echo "  ERROR: Provisioner failed"
        curl -s -H "Coder-Session-Token: $CODER_TOKEN" \
          "${CODER_URL}/api/v2/templateversions/${version_id}/logs" | \
          python3 -c "import sys,json; [print(l.get('output','')) for l in json.load(sys.stdin)]" 2>/dev/null | tail -10
        return 1
      fi
      sleep 2
    done

    # Create template
    echo "  Creating template..."
    curl -s -X POST \
      -H "Coder-Session-Token: $CODER_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{
        \"name\": \"$name\",
        \"display_name\": \"$display_name\",
        \"description\": \"$description\",
        \"icon\": \"$icon\",
        \"template_version_id\": \"$version_id\",
        \"default_ttl_ms\": 86400000
      }" \
      "${CODER_URL}/api/v2/organizations/${ORG}/templates" >/dev/null

    echo "  Template created!"
  fi

  rm -f "$tarfile"
  echo ""
}

push_template "$TEMPLATES_DIR/python" "python3" "Python 3.12" \
  "Python development environment with pip, virtualenv, black, flake8, pytest" \
  "/icon/python.svg"

push_template "$TEMPLATES_DIR/java" "java21" "Java 21 (Temurin)" \
  "Java development environment with Maven, Gradle, JDK 21" \
  "/icon/java.svg"

push_template "$TEMPLATES_DIR/nodejs" "nodejs20" "Node.js 20" \
  "Node.js development environment with TypeScript, ESLint, Prettier" \
  "/icon/nodejs.svg"

echo "=== All templates pushed ==="
echo "Verify: ${CODER_URL}/templates"
