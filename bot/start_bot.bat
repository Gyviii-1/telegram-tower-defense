@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Запускаю бота Tower Defense...
python bot.py
echo.
echo Бот остановлен. Нажми любую клавишу, чтобы закрыть окно.
pause >nul
