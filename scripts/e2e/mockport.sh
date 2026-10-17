# shellcheck shell=bash
# Sourced by smoke.sh: is the mock's port already answering? A mock left by a run whose client side was killed (ssh
# dropped, `timeout`) keeps the port; the new mock then fails to bind and the suite talks to the stale one (old pair
# codes, old turns: false failures). Refuse instead.
#   mock_port_taken PORT   → 0 when something answers on 127.0.0.1:PORT (prints what), 1 when the port is free
mock_port_taken() {
  local port="$1" state
  state=$(curl -fsS --max-time 2 "http://127.0.0.1:$port/__e2e/state" 2>/dev/null) && { echo "an E2E mock answers on port $port (left by a killed run?): ${state:0:120}"; return 0; }
  # anything else listening there (not a mock) blocks the bind just as well
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then echo "port $port is taken by another program"; return 0; fi
  return 1
}
