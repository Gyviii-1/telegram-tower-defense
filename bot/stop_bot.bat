@echo off
chcp 65001 >nul
echo Останавливаю бота...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -like '*bot.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo Готово.
pause >nul
