#!/bin/bash

# Script de instalación automática para Dream Clean App
# Compatible con Ubuntu 20.04/22.04

echo "--- Iniciando instalación de Dream Clean ---"

# 1. Actualizar sistema
sudo apt update && sudo apt upgrade -y

# 2. Instalar dependencias de Puppeteer (WhatsApp)
echo "--- Instalando dependencias de Puppeteer ---"
sudo apt install -y gconf-service libgbm-dev libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils wget git

# 3. Instalar Node.js (v20)
echo "--- Instalando Node.js ---"
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm install 20
nvm use 20

# 4. Instalar PM2 globalmente
echo "--- Instalando PM2 ---"
npm install pm2 -g

# 5. Clonar repositorio
echo "--- Clonando el código ---"
cd ~
git clone https://github.com/underkraker/wbe-angeles-
cd wbe-angeles-

# 6. Instalar dependencias de la app
echo "--- Instalando dependencias de la App ---"
npm install

# 7. Configurar PM2
echo "--- Iniciando Aplicación ---"
pm2 start server.js --name "dream-clean"
pm2 save
pm2 startup | tail -n1 | bash

echo "--- ¡INSTALACIÓN COMPLETADA! ---"
echo "Para vincular WhatsApp, sigue estos pasos:"
echo "1. Ejecuta: pm2 stop dream-clean"
echo "2. Ejecuta: node server.js"
echo "3. Escanea el QR"
echo "4. Presiona Ctrl+C y luego: pm2 start dream-clean"
