#!/bin/sh
set -eu

log_step() {
  echo "[startup] $1"
}

run_step() {
  step_name="$1"
  shift

  log_step "Running ${step_name}..."
  if "$@"; then
    log_step "${step_name} completed."
  else
    code=$?
    log_step "${step_name} failed with exit code ${code}. Aborting startup."
    exit "$code"
  fi
}

run_step "db:migrate:runtime" node dist/db/migrate.js
run_step "db:seed" node dist/db/seed.js
run_step "start" node dist/server.js
