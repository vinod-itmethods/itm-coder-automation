terraform {
  required_providers {
    coder = {
      source  = "coder/coder"
      version = ">= 2.13"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.35"
    }
  }
}

provider "coder" {}

variable "namespace" {
  type    = string
  default = "lab-poc-coder"
}

data "coder_provisioner" "me" {}
data "coder_workspace" "me" {}
data "coder_workspace_owner" "me" {}

provider "kubernetes" {}

resource "coder_agent" "main" {
  arch = data.coder_provisioner.me.arch
  os   = "linux"

  # AI Bridge: route AI traffic through Coder for governance, audit & cost tracking
  env = {
    ANTHROPIC_BASE_URL = "${data.coder_workspace.me.access_url}/api/v2/aibridge/anthropic"
    ANTHROPIC_API_KEY  = data.coder_workspace_owner.me.session_token
    OPENAI_BASE_URL    = "${data.coder_workspace.me.access_url}/api/v2/aibridge/openai/v1"
    OPENAI_API_KEY     = data.coder_workspace_owner.me.session_token
  }

  startup_script = <<-EOT
    set -e

    # Install GitHub Copilot for code-server (VSIX sideload, not on Open VSX)
    which jq >/dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq jq >/dev/null 2>&1) || true
    if ! code-server --list-extensions 2>/dev/null | grep -qi "github.copilot"; then
      curl -fsSL https://raw.githubusercontent.com/sunpix/howto-install-copilot-in-code-server/refs/heads/main/install-copilot.sh | bash 2>/dev/null || true
    fi

    # Python tools
    pip3 install --user --quiet black flake8 mypy pytest 2>/dev/null || true
  EOT

  metadata {
    display_name = "CPU Usage"
    key          = "0_cpu_usage"
    script       = "coder stat cpu"
    interval     = 10
    timeout      = 1
  }

  metadata {
    display_name = "RAM Usage"
    key          = "1_ram_usage"
    script       = "coder stat mem"
    interval     = 10
    timeout      = 1
  }
}

module "code-server" {
  count    = data.coder_workspace.me.start_count
  source   = "registry.coder.com/coder/code-server/coder"
  version  = "~> 1.0"
  agent_id = coder_agent.main.id
}

resource "kubernetes_pod_v1" "main" {
  count = data.coder_workspace.me.start_count

  timeouts {
    create = "15m"
  }

  metadata {
    name      = "coder-${lower(data.coder_workspace_owner.me.name)}-${lower(data.coder_workspace.me.name)}"
    namespace = var.namespace
    labels = {
      "app.kubernetes.io/name"     = "coder-workspace"
      "app.kubernetes.io/instance" = "coder-workspace-${lower(data.coder_workspace.me.name)}"
    }
  }

  spec {
    toleration {
      key      = "coder.com/provisioner"
      operator = "Equal"
      value    = "true"
      effect   = "NoSchedule"
    }
    toleration {
      key      = "app"
      operator = "Equal"
      value    = "coder"
      effect   = "NoSchedule"
    }

    container {
      name              = "dev"
      image             = "python:3.12"
      image_pull_policy = "IfNotPresent"
      command = ["sh", "-c", <<-EOT
        ARCH="${data.coder_provisioner.me.arch}"
        BINARY="/tmp/coder"

        # Download coder agent binary (try internal K8s service, then external)
        for URL in \
          "http://${var.namespace}:8080" \
          "http://${var.namespace}.${var.namespace}.svc.cluster.local:8080" \
          "${data.coder_workspace.me.access_url}"; do
          if curl -fsSL --connect-timeout 5 "$URL/bin/coder-linux-$ARCH" -o "$BINARY" 2>/dev/null; then
            chmod +x "$BINARY"
            export CODER_AGENT_URL="$URL"
            export CODER_AGENT_TOKEN="${coder_agent.main.token}"
            exec "$BINARY" agent
          fi
        done
        echo "ERROR: Failed to download coder agent" && exit 1
      EOT
      ]

      resources {
        requests = {
          "cpu"    = "250m"
          "memory" = "256Mi"
        }
        limits = {
          "cpu"    = "2"
          "memory" = "2Gi"
        }
      }

      volume_mount {
        mount_path = "/home/coder"
        name       = "home"
      }
    }

    volume {
      name = "home"
      empty_dir {}
    }
  }
}
