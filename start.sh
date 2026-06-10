#!/bin/bash

# ─────────────────────────────────────────────────────────────
#  Smart Loop Mapper — Start Script
#  Uruchamia jednocześnie:
#    • Backend  FastAPI  → http://localhost:8000
#    • Frontend Vite     → http://localhost:5173
# ─────────────────────────────────────────────────────────────

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
RESET='\033[0m'

echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${CYAN}  🏃 Smart Loop Mapper — Dev Start${RESET}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"

# ── Czyszczenie przy wyjściu ────────────────────────────────
cleanup() {
  echo -e "\n${YELLOW}🛑 Zatrzymywanie serwerów...${RESET}"
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null
  wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null
  echo -e "${RED}✗ Zamknięto wszystkie procesy.${RESET}\n"
  exit 0
}
trap cleanup SIGINT SIGTERM

# ── Backend ─────────────────────────────────────────────────
echo -e "${YELLOW}▶ Uruchamiam Backend (FastAPI)...${RESET}"

if [ ! -d "$BACKEND_DIR/venv" ]; then
  echo -e "${RED}  ✗ Brak venv w $BACKEND_DIR/venv — najpierw utwórz środowisko:${RESET}"
  echo -e "    cd backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

(
  cd "$BACKEND_DIR"
  source venv/bin/activate
  python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload 2>&1 | \
    sed "s/^/  ${GREEN}[backend]${RESET} /"
) &
BACKEND_PID=$!

# ── Poczekaj chwilę żeby backend zdążył wystartować ─────────
sleep 2

# ── Frontend ─────────────────────────────────────────────────
echo -e "${YELLOW}▶ Uruchamiam Frontend (Vite)...${RESET}"

(
  cd "$FRONTEND_DIR"
  npm run dev 2>&1 | \
    sed "s/^/  ${CYAN}[frontend]${RESET} /"
) &
FRONTEND_PID=$!

echo -e "\n${GREEN}✓ Oba serwery uruchomione!${RESET}"
echo -e "  ${CYAN}Frontend → http://localhost:5173${RESET}"
echo -e "  ${GREEN}Backend  → http://localhost:8000${RESET}"
echo -e "\n  Naciśnij ${RED}Ctrl+C${RESET} aby zatrzymać wszystko.\n"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"

# ── Czekaj na procesy ────────────────────────────────────────
wait "$BACKEND_PID" "$FRONTEND_PID"
