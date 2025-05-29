const fs = require("fs-extra");
const path = require("path");

const dictionaryCache = {};

const dictionaryMapping = {
  cedula: "Diccionario_Documentos_Identidad.txt",
  diploma_bachiller: "DiccionarioActayDiplomaBachiller.txt",
  diploma_tecnico: "DiccionarioActayDiplomaTecnico.txt",
  diploma_tecnologo: "DiccionarioActayDiplomaTecnologo.txt",
  titulo_profesional: "DiccionarioActayDiplomaPregrado.txt",
  prueba_tt: "DiccionarioTYT.txt",
  icfes: "DiccionarioIcfes.txt",
  recibo_pago: "DiccionarioPagoDerechosDeGrado.txt",
  encuesta_m0: "DiccionarioEncuestaSeguimiento.txt",
  acta_homologacion: "DiccionarioActaHomologacion.txt",
  cun_institutions: "DiccionarioCUN.txt",
};

async function getDictionaryForDocumentType(documentType) {
  const dictionaryFileName = dictionaryMapping[documentType];

  if (!dictionaryFileName) {
    console.warn(
      `[DICT] No se encontró mapeo de diccionario para el tipo: ${documentType}`
    );
    return [];
  }
  return await loadDictionary(dictionaryFileName);
}

async function loadDictionary(dictionaryFileName) {
  try {
    const dictionaryPath = path.join(
      process.cwd(),
      "dictionaries",
      dictionaryFileName
    );
    const content = await fs.readFile(dictionaryPath, "utf8");
    const keywords = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    dictionaryCache[dictionaryFileName] = keywords;
    return keywords;
  } catch (error) {
    throw error;
  }
}

module.exports = {
  getDictionaryForDocumentType
};