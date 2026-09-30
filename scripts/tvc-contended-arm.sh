#!/usr/bin/env bash
# The contended arm, committed so the next lane RUNS it instead of
# re-deriving it from prose (three lanes have paid that cost). The arm
# itself — image pin, copy-to-/tmp/pkg recipe, taskset hold, the exact
# playwright invocation, hog shape — is verbatim from
# docs/transcript-visual-contract.md ("Known residual, still open");
# hog count is part of the arm, so rates from different hog counts are
# never comparable. The only additions are artifact plumbing that acts
# outside the suite's execution window: an /artifacts mount, an
# unconditional post-suite copy-out, and a stdout tee.
#
# Usage:
#   npm run tvc:contended-arm -- ARTIFACT_DIR [BATCHES] [HOGS]
#   (or: scripts/tvc-contended-arm.sh ARTIFACT_DIR [BATCHES] [HOGS])
#
#   ARTIFACT_DIR  host directory for per-batch artifacts (relative
#                 paths are resolved — docker rejects a relative bind
#                 source). This script never deletes anything under it
#                 — a prior lane destroyed a failure's artifacts with
#                 its own cleanup, and one catch may be all a campaign
#                 ever gets.
#   BATCHES       max batches to run IN THIS INVOCATION (default 1).
#                 One batch = 45 executions of the TVC-155 test (90
#                 captures). Batch numbering resumes past the highest
#                 existing batch-NNN in ARTIFACT_DIR, so a campaign is
#                 extended by re-invoking with the same dir and the
#                 ledger accumulates across invocations.
#   HOGS          host CPU hogs pinned to cores 0,1 (default 4 — the
#                 contended arm; 0 = solo verification arm).
#
# Env: MAX_SECONDS (default 21600) — wall-clock cap, checked BETWEEN
#      batches, so the batch in flight when it trips is finished, not
#      interrupted; EXTRA_AFTER_CATCH (default 1) — batches to run
#      after the first batch containing a failing capture. Both caps
#      (BATCHES, MAX_SECONDS) take precedence over EXTRA_AFTER_CATCH:
#      a catch in the final batch gets no extras.
#
# Ledger schema: batch,exit,failCaptures,probeRecords,seconds,
# hogsBefore,hogsAfter — failCaptures counts FAILING CAPTURES (probe
# records with phase "post-capture" and captureFailed true; a failing
# capture also emits a "delayed" re-read, deliberately not counted —
# every rate in the doc is catches per execution, and round 2 caught
# the raw grep double-counting). A batch whose hogsAfter is below
# hogsBefore ran part of its executions under a degraded hold: exclude
# it from any pooled rate. An interrupted batch writes NO row — its
# partial container.log in the batch dir is the trace.
#
# Exit codes: 0 campaign completed (any of the three stop conditions);
# 2 reuse backstop; 3 arm integrity lost (hog died — before OR during
# a batch; the degraded batch's row is written first); 4 artifact path
# could not be created/resolved; 5 void batch (zero probe records —
# docker, npm or playwright failed before any capture ran; nothing
# this batch produced is data); 130 interrupted.
#
# CONTRACT ENUMERATION (round-1 sweep, re-established EXECUTABLY in
# round 2 after a row was caught asserting a guarantee the flow did
# not deliver — each row now names the exercise that showed it hold;
# "authored" rows have been caught twice, so none remain):
#   1. Hog count is part of the arm → hogs start before batch 1;
#      INT/TERM exits (130) instead of resuming hog-less; hog liveness
#      is read before AND after every batch (round 2: the before-only
#      read recorded a mid-batch hog death as a full-arm batch),
#      ledgered per batch, and any loss stops the campaign (exit 3)
#      after writing the degraded row. Exercised: a hog killed
#      mid-batch produced hogsBefore=2,hogsAfter=1 on that batch's own
#      row and exit 3 with no further batch; SIGTERM mid-batch exited
#      130 at the batch boundary with all hogs dead, NO row for the
#      interrupted batch and no further ones (bash defers the trap
#      until the in-flight command returns; a terminal Ctrl-C also
#      signals the docker client directly). Caveat, learned by
#      exercising it: a campaign launched as a BACKGROUND job has
#      SIGINT ignored at entry (POSIX), so the INT trap cannot arm —
#      stop a backgrounded campaign with TERM.
#   2. Never delete, never overwrite → no rm under ARTIFACT_DIR
#      anywhere in this file; numbering seeds past the highest
#      existing batch-NNN; the reuse guard stays as a backstop (exit
#      2). Exercised: two invocations into one dir produced batch-001,
#      batch-002 and one accumulated ledger; the backstop itself fired
#      (exit 2, refusal message) on the pre-resume numbering, and is
#      unreachable through public inputs since — retained as
#      defense-in-depth against numbering regressions.
#   3. Stop conditions → BATCHES bounds this invocation's loop;
#      MAX_SECONDS is checked between batches (the in-flight batch
#      completes); EXTRA_AFTER_CATCH counts batches after the catch
#      and yields to both caps. Exercised: MAX_SECONDS=1 with
#      BATCHES=3 stopped after one batch with the budget message and
#      exit 0; BATCHES bounds every solo run above; the catch rule ran
#      live in the campaign (catch in batch 70, one extra batch 71,
#      stop message, exit).
#   4. Status propagation → the container exits with playwright's
#      status (saved across the copy-out), run_batch returns it
#      through the tee pipeline via PIPESTATUS[0], the ledger records
#      it per batch, and the script exits 0 explicitly on completion.
#      Exercised: a forced docker failure ledgered its exit status
#      with zero records; the campaign's catch batch ledgered exit 1;
#      completed runs return 0.
#   5. The arm is verbatim → the docker command below is the recorded
#      recipe plus the named arm-neutral additions, and nothing here
#      passes --update-snapshots (zero baselines by mandate).
#      Exercised: grep over this file finds the flag only in this
#      comment.
#
# SILENT-ARTIFACT SWEEP (round 2: two findings were the same class —
# a wrong input or empty match producing a confident, well-formed,
# wrong artifact instead of a loud failure; every site enumerated):
#   - relative ARTIFACT_DIR → was silent (docker rejected the bind per
#     batch, the ledger filled with error rows and empty results/);
#     now resolved to absolute up front, and unreachable besides — see
#     the void-batch rule.
#   - uncreatable ARTIFACT_DIR or batch dir → loud, exit 4.
#   - a batch with ZERO probe records (docker/daemon/npm/playwright
#     died before any capture) → was a silent "ran, caught nothing"
#     row; now loud, exit 5 after the row is written. A NONZERO-exit
#     batch with records is kept and the campaign continues: that is
#     data (a catch, or the distinct starvation-timeout class, which
#     aborts single captures, never a whole batch).
#   - missing results/fractional-probe.jsonl → same as zero records.
#   - vacuous probe matches (selector rot, shadow-root migration) →
#     loud at the source: the probe throws instead of emitting an
#     empty-but-well-formed record (fractional-probe.ts).
#   - failCaptures double-count (post-capture + delayed both carry
#     captureFailed) → fixed, post-capture records only.
#   - tee failure with a healthy suite → container.log lost, jsonl
#     channel unaffected; classified acceptable-silent: it cannot
#     fabricate data, and the JSONL is the primary channel.
#   - a ledger resumed from a pre-round-2 dir keeps its original
#     header (columns differ from newer rows); classified
#     visible-silent: row width makes the boundary obvious.
#   Round 3: this sweep had stopped at the file boundary and missed a
#   member of the same class inside the probe's own record (an in-page
#   Date.now() under a faked clock recorded as `epochMs`). The sweep
#   now crosses that boundary: every record field is classified by
#   measurement context in fractional-probe.ts (FIELD PROVENANCE), and
#   the JSONL schema boundary (v <= 2 records carry the faked value)
#   is recorded there too.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE="mcr.microsoft.com/playwright:v1.63.0-noble"

ART="${1:?usage: tvc-contended-arm.sh ARTIFACT_DIR [BATCHES] [HOGS]}"
BATCHES="${2:-1}"
HOGS="${3:-4}"
MAX_SECONDS="${MAX_SECONDS:-21600}"
EXTRA_AFTER_CATCH="${EXTRA_AFTER_CATCH:-1}"

# Docker requires an absolute bind source; a relative one is parsed as
# a volume name and rejected — which round 2 caught turning a whole
# campaign into error rows. Resolve first, loudly.
mkdir -p "$ART" || exit 4
ART="$(cd "$ART" && pwd)" || exit 4
[ -n "$ART" ] || exit 4

LEDGER="$ART/ledger.csv"
[ -f "$LEDGER" ] ||
  echo "batch,exit,failCaptures,probeRecords,seconds,hogsBefore,hogsAfter" >"$LEDGER"

HOG_PIDS=()
cleanup() {
  if [ "${#HOG_PIDS[@]}" -gt 0 ]; then
    kill "${HOG_PIDS[@]}" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

hogs_alive() {
  local n=0 pid
  for pid in ${HOG_PIDS[@]+"${HOG_PIDS[@]}"}; do
    kill -0 "$pid" 2>/dev/null && n=$((n + 1))
  done
  echo "$n"
}

run_batch() { # $1 = batch artifact dir
  docker run --rm -v "$ROOT":/work -v "$1":/artifacts "$IMAGE" /bin/bash -lc '
    cp -r /work /tmp/pkg &&
    rm -rf /tmp/pkg/node_modules /tmp/pkg/fixtures/*/out /tmp/pkg/tests-e2e/results &&
    cd /tmp/pkg && npm ci --silent &&
    taskset -c 0,1 npx playwright test tests-e2e/tvc-screenshots.spec.ts -g "TVC-155" --repeat-each=45 --workers 1
    status=$?
    cp -r /tmp/pkg/tests-e2e/results /artifacts/results
    exit $status
  ' 2>&1 | tee "$1/container.log"
  return "${PIPESTATUS[0]}"
}

for ((i = 0; i < HOGS; i++)); do
  taskset -c 0,1 sh -c 'while :; do :; done' &
  HOG_PIDS+=("$!")
done

# Resume-aware numbering: continue past the highest existing batch-NNN.
LAST=0
for d in "$ART"/batch-*; do
  [ -d "$d" ] || continue
  b="${d##*batch-}"
  case $b in *[!0-9]*) continue ;; esac
  b=$((10#$b))
  [ "$b" -gt "$LAST" ] && LAST=$b
done

START=$(date +%s)
CAUGHT=""
for ((i = 1; i <= BATCHES; i++)); do
  n=$((LAST + i))
  batch_dir="$ART/batch-$(printf '%03d' "$n")"
  if [ -e "$batch_dir/container.log" ]; then
    echo "refusing to reuse $batch_dir — artifacts are never overwritten" >&2
    exit 2
  fi
  mkdir -p "$batch_dir" || exit 4
  hogs_before=$(hogs_alive)
  if [ "$hogs_before" -ne "$HOGS" ]; then
    echo "arm integrity lost: $hogs_before of $HOGS hogs alive — stopping before batch $n" >&2
    exit 3
  fi
  batch_start=$(date +%s)
  run_batch "$batch_dir"
  status=$?
  hogs_after=$(hogs_alive)
  jsonl="$batch_dir/results/fractional-probe.jsonl"
  fails=0
  records=0
  if [ -f "$jsonl" ]; then
    fails=$(grep '"captureFailed":true' "$jsonl" | grep -c '"phase":"post-capture"' || true)
    records=$(wc -l <"$jsonl")
  fi
  echo "$n,$status,$fails,$records,$(($(date +%s) - batch_start)),$hogs_before,$hogs_after" >>"$LEDGER"
  if [ "$records" -eq 0 ]; then
    echo "void batch $n: zero probe records (exit $status) — nothing it produced is data" >&2
    exit 5
  fi
  if [ "$hogs_after" -ne "$HOGS" ]; then
    echo "arm integrity lost during batch $n: $hogs_after of $HOGS hogs alive — its row is degraded, stopping" >&2
    exit 3
  fi
  if [ "$fails" -gt 0 ] && [ -z "$CAUGHT" ]; then
    CAUGHT=$n
  fi
  if [ -n "$CAUGHT" ] && [ $((n - CAUGHT)) -ge "$EXTRA_AFTER_CATCH" ]; then
    echo "first catch in batch $CAUGHT + $EXTRA_AFTER_CATCH more — stopping"
    break
  fi
  if [ $(($(date +%s) - START)) -ge "$MAX_SECONDS" ]; then
    echo "wall-clock budget ($MAX_SECONDS s) reached — stopping"
    break
  fi
done
exit 0
