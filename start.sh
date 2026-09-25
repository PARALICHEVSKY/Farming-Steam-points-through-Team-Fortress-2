#!/usr/bin/env bash
# Запуск на macOS / Linux: ./start.sh  (на macOS можно дважды кликнуть start.command)
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Не найден Node.js — без него программа не запустится."
  echo "Скачайте версию LTS с https://nodejs.org/ , установите и запустите этот файл снова."
  echo
  exit 1
fi

if [ ! -d node_modules ]; then
  echo
  echo "Первый запуск: устанавливаю нужные файлы, это 1-2 минуты..."
  echo
  npm install --no-audit --no-fund || { echo "Не удалось установить файлы. Проверьте интернет."; exit 1; }
fi

node src/index.js
