@echo off
cd /d "%~dp0"
echo ย่านเสียง (Voice Range)  ->  http://localhost:8800
start "" http://localhost:8800
python -m http.server 8800 --bind 127.0.0.1
