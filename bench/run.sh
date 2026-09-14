#!/usr/bin/env bash
set -euo pipefail

# Benchmark runner for IndexNow Server.
# Usage: ./bench/run.sh [--label NAME] [--scale N] [--target URLS] [--skip-seed]
#
# Profiles (set via --label):
#   pi-1cpu-1gb   - Raspberry Pi class (taskset 1 CPU, ulimit memory)
#   dev-2cpu-4gb  - Dev machine constrained
#   dev-full      - No constraints (default)

cd "$(dirname "$0")/.."

LABEL="dev-full"
SCALE=1
TARGET=1000000
SKIP_SEED=false
PORT=13020  # avoid clashing with running dev server

while [[ $# -gt 0 ]]; do
  case $1 in
    --label) LABEL="$2"; shift 2 ;;
    --scale) SCALE="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --skip-seed) SKIP_SEED=true; shift ;;
    --port) PORT="$2"; shift 2 ;;
    *) echo "Unknown: $1"; exit 1 ;;
  esac
done

BENCH_DB="bench/bench.db"
RESULTS_DIR="bench/results"
OUT="$RESULTS_DIR/${LABEL}.json"

echo "=== IndexNow Server Benchmark ==="
echo "Label:  $LABEL"
echo "Scale:  $SCALE"
echo "Target: $TARGET URLs"
echo "Port:   $PORT"
echo ""

# Step 1: Seed
if [ "$SKIP_SEED" = false ]; then
  echo "--- Seeding database ---"
  node bench/seed.mjs --target "$TARGET" --out "$BENCH_DB"
  echo ""
fi

if [ ! -f "$BENCH_DB" ]; then
  echo "ERROR: $BENCH_DB not found. Run without --skip-seed first."
  exit 1
fi

# Step 2: Start server
echo "--- Starting server on port $PORT ---"
DATABASE_PATH="$BENCH_DB" \
  PORT="$PORT" \
  NODE_ENV=production \
  DRY_RUN=true \
  DISABLE_CRON=true \
  AUTH_ENABLED=false \
  node --import tsx src/server/index.ts &
SERVER_PID=$!

cleanup() {
  echo "Stopping server (PID $SERVER_PID)..."
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT

# Wait for server ready
echo "Waiting for server..."
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$PORT/api/settings" > /dev/null 2>&1; then
    echo "Server ready after ${i}s"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Server did not start in 30s"
    exit 1
  fi
  sleep 1
done
echo ""

# Step 3: Run benchmark
echo "--- Running benchmark ---"
node bench/bench.mjs \
  --base "http://127.0.0.1:$PORT" \
  --out "$OUT" \
  --label "$LABEL" \
  --scale "$SCALE"

echo ""
echo "=== Results: $OUT ==="
# Print summary table
node -e "
const r = JSON.parse(require('fs').readFileSync('$OUT', 'utf8'));
if (r.failed) { console.log('FAILED:', r.failed); process.exit(1); }
console.log('Label:', r.label, '| URLs:', r.url_count, '| Sites:', r.site_count);
console.log('Total wall time:', Math.round(r.total_wall_ms / 1000) + 's');
console.log('');
console.log('Phase'.padEnd(30), 'ops/s'.padStart(8), 'avg'.padStart(8), 'p50'.padStart(8), 'p95'.padStart(8), 'p99'.padStart(8), 'max'.padStart(8));
console.log('-'.repeat(86));
for (const p of r.phases) {
  console.log(
    p.name.padEnd(30),
    String(p.ops_per_sec).padStart(8),
    (p.avg_ms + 'ms').padStart(8),
    (p.p50_ms + 'ms').padStart(8),
    (p.p95_ms + 'ms').padStart(8),
    (p.p99_ms + 'ms').padStart(8),
    (p.max_ms + 'ms').padStart(8),
  );
}
"
