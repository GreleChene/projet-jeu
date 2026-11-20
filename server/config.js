'use strict';
// Configuration (surchargée par variables d'environnement)
module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  DATA_FILE: process.env.DATA_FILE || require('path').join(__dirname, '..', 'data', 'db.json'),
  // Mettre à 1 derrière HTTPS (cookie « Secure »)
  SECURE_COOKIES: process.env.SECURE_COOKIES === '1',
  SESSION_DAYS: 30,
  // URL affichée sur le stream pour rejoindre
  PUBLIC_URL: process.env.PUBLIC_URL || '',
  TICK_RATE: 20, // simulations / s
  SNAPSHOT_RATE: 20, // envois à l'écran du stream / s
  PLAYER_RATE: 4 // envois aux joueurs / s
};
