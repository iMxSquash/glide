#!/bin/bash

# Test script pour vérifier que le serveur peut servir le PWA

echo "🔍 Vérification de la configuration..."
echo ""

# Vérifier que le PWA est buildé
if [ -f "dist/apps/client-pwa/index.html" ]; then
  echo "✅ PWA build trouvé: dist/apps/client-pwa/"
else
  echo "❌ PWA build manquant. Lancer: npm run build:client"
  exit 1
fi

# Vérifier que le serveur est buildé
if [ -f "apps/server-electron/dist/src/main.js" ]; then
  echo "✅ Server build trouvé: apps/server-electron/dist/src/"
else
  echo "❌ Server build manquant. Lancer: npm run build:server"
  exit 1
fi

# Vérifier le chemin relatif
cd apps/server-electron/dist/src
if [ -f "../../../../dist/apps/client-pwa/index.html" ]; then
  echo "✅ Chemin relatif correct depuis main.js"
  cd ../../../..
else
  echo "❌ Chemin relatif incorrect"
  cd ../../../..
  exit 1
fi

echo ""
echo "🎉 Configuration OK !"
echo ""
echo "Pour tester:"
echo "  npm run dev:server"
echo ""
echo "Puis sur iPhone Safari:"
echo "  https://<IP-affichée>:3000"
