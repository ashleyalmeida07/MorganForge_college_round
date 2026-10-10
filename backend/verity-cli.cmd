@echo off
rem verity-cli verify ^<request_pda^>  ^|  verity-cli evidence ^<bundle.zip^>
set "PY=%~dp0.venv\Scripts\python.exe"
if not exist "%PY%" set "PY=python"
"%PY%" "%~dp0scripts\verity_cli.py" %*
