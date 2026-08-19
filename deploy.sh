#!/usr/bin/env bash

set -euo pipefail

APP_DIR="/var/www/queFem"
PM2_APP="quefem-api"
LOCAL_API="http://127.0.0.1:3014/api/plans?limit=1"
PUBLIC_URL="https://tenspla.cat"

echo "======================================"
echo "🚀 Desplegando Tens pla?"
echo "======================================"

cd "$APP_DIR"

echo
echo "1/7 🔎 Comprobando repositorio..."

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "❌ Hay cambios locales sin guardar."
    echo "Haz commit, stash o descártalos antes de desplegar."
    exit 1
fi

echo
echo "2/7 ⬇️ Descargando cambios de Git..."

git pull --ff-only

echo
echo "3/7 📦 Instalando dependencias..."

npm ci

echo
echo "4/7 🧪 Ejecutando tests..."

npm test

echo
echo "5/7 🗄️ Actualizando base de datos..."

npm run db:init

echo
echo "6/7 🏗️ Compilando frontend..."

npm run build:frontend

echo
echo "7/7 ♻️ Reiniciando backend..."

pm2 restart "$PM2_APP" --update-env
pm2 save

echo
echo "⏳ Esperando a que la API arranque..."
sleep 3

echo
echo "🔎 Comprobando API..."

if curl --fail --silent --show-error "$LOCAL_API" > /dev/null; then
    echo "✅ API funcionando correctamente"
else
    echo "❌ La API no responde."
    echo
    echo "Últimos logs:"
    pm2 logs "$PM2_APP" --lines 30 --nostream
    exit 1
fi

echo
echo "🔎 Comprobando web pública..."

if curl --fail --silent --head "$PUBLIC_URL" > /dev/null; then
    echo "✅ Web funcionando correctamente"
else
    echo "⚠️ El backend funciona, pero la web pública no responde correctamente."
    exit 1
fi

echo
echo "======================================"
echo "✅ Tens pla? desplegado correctamente"
echo "🌐 $PUBLIC_URL"
echo "======================================"
