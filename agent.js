const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

const config = require('./config.json');
const stateFile = path.join(__dirname, 'state', 'last_hash.txt');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(path.join(__dirname, 'logs', 'sync.log'), line);
  console.log(line.trim());
}

function getLatestJsonFile() {
  const files = fs.readdirSync(config.watchPath)
    .filter(f => f.match(/^voltz_productos_full_.*\.json$/))
    .map(f => {
      const fullPath = path.join(config.watchPath, f);
      const stat = fs.statSync(fullPath);
      return {
        name: f,
        path: fullPath,
        mtime: stat.mtime.getTime(),
        size: stat.size
      };
    })
    .filter(f => f.size > 0)
    .sort((a, b) => b.mtime - a.mtime);

  return files.length ? files[0] : null;
}

function calculateHash(filePath) {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function getLastHash() {
  if (!fs.existsSync(stateFile)) return null;
  return fs.readFileSync(stateFile, 'utf8').trim();
}

function saveLastHash(hash) {
  fs.writeFileSync(stateFile, hash);
}

async function sendFile(filePath) {
  const data = fs.readFileSync(filePath);

  const response = await axios.post(
    config.endpoint,
    data,
    {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Authorization': config.apiKey
      },
      timeout: config.timeoutMs
    }
  );

  return response.status;
}


async function tick() {
  try {
    const readyPath = path.join(config.watchPath, config.readyFile);

    if (!fs.existsSync(readyPath)) {
      log('Sin READY, esperando...');
      return;
    }

    log('READY detectado, buscando JSON...');

    const jsonFile = getLatestJsonFile();
    if (!jsonFile) {
      log('READY existe, pero no se encontró JSON válido');
      return;
    }

    const hash = calculateHash(jsonFile.path);
    const lastHash = getLastHash();

    log(`JSON: ${jsonFile.name}`);
    log(`Hash actual: ${hash}`);

    if (hash === lastHash) {
      log('Este archivo ya fue enviado anteriormente. No se reenvía.');
      return;
    }

    log('Enviando archivo al proveedor...');

    const status = await sendFile(jsonFile.path);

    if (status >= 200 && status < 300) {
      log(`POST exitoso (HTTP ${status})`);
      saveLastHash(hash);
      fs.unlinkSync(readyPath);
      log('READY eliminado. Proceso completo.');
    } else {
      log(`POST respondió HTTP ${status}. READY se conserva.`);
    }

  } catch (err) {
    log(`ERROR en envío: ${err.message}`);
  }
}

log('Agente Voltz iniciado (Paso 6: POST real)');
setInterval(tick, config.pollIntervalSeconds * 1000);
