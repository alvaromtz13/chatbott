const fs = require('fs').promises;
const path = require('path');

const dataDir = path.join(__dirname, 'data');

// Asegurarse de que el directorio 'data' exista
fs.mkdir(dataDir, { recursive: true }).catch(console.error);

async function saveToFile(filename, content) {
  try {
    const filePath = path.join(dataDir, filename);
    await fs.writeFile(filePath, content, 'utf8');
    console.log(`Información guardada en ${filename}`);
    return true;
  } catch (error) {
    console.error(`Error al guardar en ${filename}:`, error);
    return false;
  }
}

async function readFromFile(filename) {
  try {
    const filePath = path.join(dataDir, filename);
    const content = await fs.readFile(filePath, 'utf8');
    return content;
  } catch (error) {
    console.error(`Error al leer ${filename}:`, error);
    return null;
  }
}

module.exports = { saveToFile, readFromFile };