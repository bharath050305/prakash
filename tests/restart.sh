#!/bin/bash
# dev helper: restart the server with freshly generated demo data
cd "$(dirname "$0")/.."
powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { \$_.CommandLine -like '*run.py*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }"
sleep 1; rm -f data/prakash.db*
(PYTHONIOENCODING=utf-8 python run.py > data/server.log 2>&1 &)
for i in $(seq 1 30); do sleep 1; curl -s -o /dev/null http://127.0.0.1:5000/api/meta && break; done
echo restarted
