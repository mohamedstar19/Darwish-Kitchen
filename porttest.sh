port_busy() {
  ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$1\$" && return 0
  timeout 1 bash -c "echo > /dev/tcp/127.0.0.1/$1" 2>/dev/null
}
PORT=3020
while port_busy "$PORT"; do echo "busy $PORT"; PORT=$((PORT + 1)); done
echo "picked $PORT"
