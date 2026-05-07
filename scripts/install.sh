#!/usr/bin/env bash
#
# SpreadbreadAI bootstrap installer.
#
# - installs the daemon via pipx (from this repo by default)
# - ensures Ollama is reachable and pulls the default model (gemma4:e2b)
# - prints the next step for installing the LibreOffice extension
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/IrgenSlj/SpreadbreadAI/main/scripts/install.sh | bash
#   # or, from a clone:
#   ./scripts/install.sh
#
set -euo pipefail

GREEN="\033[1;32m"; RED="\033[1;31m"; YELLOW="\033[1;33m"; DIM="\033[2m"; OFF="\033[0m"
say()  { printf "%b\n" "${GREEN}==>${OFF} $*"; }
warn() { printf "%b\n" "${YELLOW}!! ${OFF} $*"; }
die()  { printf "%b\n" "${RED}!! ${OFF} $*" >&2; exit 1; }

REPO_URL="${SPREADBREAD_REPO:-https://github.com/IrgenSlj/SpreadbreadAI.git}"
MODEL="${SPREADBREAD_MODEL:-gemma4:e2b}"
PYTHON="${PYTHON:-python3}"

# 1. Python + pipx ---------------------------------------------------
command -v "$PYTHON" >/dev/null 2>&1 || die "Python 3 not found (set PYTHON=...)."
PYV="$($PYTHON -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
say "Using Python $PYV"

if ! command -v pipx >/dev/null 2>&1; then
    say "Installing pipx"
    "$PYTHON" -m pip install --user --quiet pipx
    "$PYTHON" -m pipx ensurepath || true
    export PATH="$HOME/.local/bin:$PATH"
fi

# 2. Daemon ----------------------------------------------------------
HERE="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd || true)"
if [[ -f "$HERE/core/pyproject.toml" ]]; then
    say "Installing daemon from local checkout: $HERE/core"
    pipx install --force "$HERE/core"
else
    say "Installing daemon from $REPO_URL (subdirectory: core)"
    pipx install --force "git+$REPO_URL#subdirectory=core"
fi

# 3. Ollama + model --------------------------------------------------
if ! command -v ollama >/dev/null 2>&1; then
    warn "Ollama is not installed. Install it from https://ollama.com and re-run this script."
    warn "Skipping model pull."
else
    say "Pulling local LLM: $MODEL"
    ollama pull "$MODEL"
fi

# 4. Extension hint --------------------------------------------------
cat <<EOF

${GREEN}SpreadbreadAI is installed.${OFF}

Start the daemon:
  ${DIM}spreadbread-core${OFF}

Then install the LibreOffice extension:
  1. Download spreadbreadai.oxt from the latest release:
     ${DIM}https://github.com/IrgenSlj/SpreadbreadAI/releases/latest${OFF}
  2. Open LibreOffice → Tools → Extension Manager → Add → spreadbreadai.oxt
     (or run: ${DIM}unopkg add spreadbreadai.oxt${OFF})
  3. Restart LibreOffice. The "SpreadbreadAI" menu appears in Calc.

EOF
