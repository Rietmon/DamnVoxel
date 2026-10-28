@echo off
cd /d "%~dp0"
if not exist node_modules call pnpm install
call pnpm build || pause
start "" http://localhost:4173/
call pnpm preview
