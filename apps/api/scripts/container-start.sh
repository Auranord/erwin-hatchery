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

run_step "db:migrate:runtime" pnpm db:migrate:runtime
run_step "db:seed" pnpm db:seed
run_step "start" pnpm start
