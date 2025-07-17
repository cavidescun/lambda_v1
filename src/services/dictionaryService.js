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
  console.log(`[DICT] Obteniendo diccionario para tipo: ${documentType}`);
  
  const dictionaryFileName = dictionaryMapping[documentType];

  if (!dictionaryFileName) {
    console.warn(`[DICT] No se encontró mapeo de diccionario para el tipo: ${documentType}`);
    return [];
  }
  
  try {
    const dictionary = await loadDictionary(dictionaryFileName);
    
    // CORECCIÓN: Validar y mejorar diccionarios pequeños
    if (dictionary.length < 5) {
      console.warn(`[DICT] Diccionario ${dictionaryFileName} muy pequeño (${dictionary.length} entradas), combinando con fallback`);
      return await enhanceSmallDictionary(documentType, dictionary);
    }
    
    return dictionary;
  } catch (error) {
    console.error(`[DICT] Error cargando diccionario ${dictionaryFileName}:`, error.message);
    return await getFallbackDictionary(documentType);
  }
}

async function loadDictionary(dictionaryFileName) {
  console.log(`[DICT] Intentando cargar diccionario: ${dictionaryFileName}`);
  
  // Verificar si ya está en caché
  if (dictionaryCache[dictionaryFileName]) {
    console.log(`[DICT] Diccionario encontrado en caché: ${dictionaryFileName}`);
    return dictionaryCache[dictionaryFileName];
  }

  try {
    const dictionaryPath = path.join(process.cwd(), "dictionaries", dictionaryFileName);
    
    // Verificar que el archivo existe
    const exists = await fs.pathExists(dictionaryPath);
    if (!exists) {
      throw new Error(`Archivo de diccionario no encontrado: ${dictionaryPath}`);
    }
    
    const content = await fs.readFile(dictionaryPath, "utf8");
    
    if (!content || content.trim().length === 0) {
      throw new Error(`Diccionario está vacío: ${dictionaryFileName}`);
    }
    
    const keywords = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      // Filtrar comentarios que empiecen con # o //
      .filter((line) => !line.startsWith('#') && !line.startsWith('//'))
      // Remover duplicados
      .filter((value, index, self) => self.indexOf(value) === index);

    if (keywords.length === 0) {
      throw new Error(`No se encontraron palabras clave válidas en: ${dictionaryFileName}`);
    }

    // Guardar en caché
    dictionaryCache[dictionaryFileName] = keywords;
    
    console.log(`[DICT] Diccionario cargado exitosamente: ${dictionaryFileName} (${keywords.length} palabras únicas)`);
    
    return keywords;
  } catch (error) {
    console.error(`[DICT] Error cargando ${dictionaryFileName}:`, error.message);
    throw error;
  }
}

// NUEVA FUNCIÓN: Mejorar diccionarios pequeños con palabras de fallback
async function enhanceSmallDictionary(documentType, originalDictionary) {
  console.log(`[DICT] Mejorando diccionario pequeño para: ${documentType}`);
  
  const fallbackWords = getFallbackWordsForType(documentType);
  const enhanced = [...new Set([...originalDictionary, ...fallbackWords])];
  
  console.log(`[DICT] Diccionario mejorado: ${originalDictionary.length} -> ${enhanced.length} palabras`);
  
  return enhanced;
}

// NUEVA FUNCIÓN: Obtener diccionario de emergencia
async function getFallbackDictionary(documentType) {
  console.warn(`[DICT] Usando diccionario de fallback para: ${documentType}`);
  
  const fallbackWords = getFallbackWordsForType(documentType);
  
  if (fallbackWords.length === 0) {
    console.error(`[DICT] No hay palabras de fallback para: ${documentType}`);
    return ['documento', 'válido', 'información']; // Fallback mínimo
  }
  
  return fallbackWords;
}

// NUEVA FUNCIÓN: Palabras de fallback por tipo de documento
function getFallbackWordsForType(documentType) {
  const fallbackMappings = {
    cedula: [
      'cédula', 'cedula', 'ciudadanía', 'ciudadania', 'documento', 'identidad',
      'registrador', 'registro', 'civil', 'estado', 'nacional',
      'república', 'republica', 'colombia', 'número', 'numero'
    ],
    diploma_bachiller: [
      'bachiller', 'académico', 'academico', 'media', 'educación', 'educacion',
      'superior', 'título', 'titulo', 'diploma', 'grado', 'certificado',
      'institucional', 'colegio', 'instituto'
    ],
    diploma_tecnico: [
      'técnico', 'tecnico', 'tecnología', 'tecnologia', 'formación', 'formacion',
      'profesional', 'diploma', 'certificado', 'título', 'titulo', 'grado'
    ],
    diploma_tecnologo: [
      'tecnólogo', 'tecnologo', 'tecnología', 'tecnologia', 'superior',
      'formación', 'formacion', 'profesional', 'diploma', 'título', 'titulo', 'grado'
    ],
    titulo_profesional: [
      'profesional', 'universitario', 'superior', 'grado', 'título', 'titulo',
      'diploma', 'educación', 'educacion', 'universidad', 'facultad'
    ],
    prueba_tt: [
      'transición', 'transicion', 'trabajo', 'saber', 'icfes', 'evaluación', 'evaluacion',
      'competencias', 'prueba', 'examen', 'resultado', 'puntaje'
    ],
    icfes: [
      'icfes', 'saber', 'once', '11', 'evaluación', 'evaluacion', 'prueba',
      'examen', 'resultado', 'puntaje', 'competencias', 'educación', 'educacion'
    ],
    recibo_pago: [
      'pago', 'recibo', 'derechos', 'grado', 'valor', 'cancelado', 'pagado',
      'factura', 'comprobante', 'transacción', 'transaccion'
    ],
    encuesta_m0: [
      'encuesta', 'seguimiento', 'momento', 'observatorio', 'laboral',
      'graduados', 'programa', 'formación', 'formacion', 'empleabilidad'
    ],
    acta_homologacion: [
      'homologación', 'homologacion', 'reconocimiento', 'convalidación', 'convalidacion',
      'equivalencia', 'materias', 'asignaturas', 'créditos', 'creditos'
    ],
    cun_institutions: [
      'corporación', 'corporacion', 'unificada', 'nacional', 'cun',
      'educación', 'educacion', 'superior', 'universidad', 'institución', 'institucion'
    ]
  };
  
  return fallbackMappings[documentType] || [];
}

// NUEVA FUNCIÓN: Validar diccionario cargado
function validateDictionary(dictionary, dictionaryName) {
  if (!Array.isArray(dictionary)) {
    throw new Error(`Diccionario ${dictionaryName} no es un array`);
  }
  
  if (dictionary.length === 0) {
    throw new Error(`Diccionario ${dictionaryName} está vacío`);
  }
  
  const validWords = dictionary.filter(word => 
    word && typeof word === 'string' && word.trim().length > 0
  );
  
  if (validWords.length === 0) {
    throw new Error(`Diccionario ${dictionaryName} no contiene palabras válidas`);
  }
  
  const percentage = (validWords.length / dictionary.length) * 100;
  
  if (percentage < 80) {
    console.warn(`[DICT] Diccionario ${dictionaryName} tiene solo ${percentage.toFixed(1)}% de entradas válidas`);
  }
  
  return {
    isValid: true,
    totalWords: dictionary.length,
    validWords: validWords.length,
    validPercentage: percentage
  };
}

// NUEVA FUNCIÓN: Precargar diccionarios al inicio
async function preloadDictionaries() {
  console.log(`[DICT] Precargando diccionarios...`);
  
  const loadPromises = Object.entries(dictionaryMapping).map(async ([type, fileName]) => {
    try {
      await loadDictionary(fileName);
      console.log(`[DICT] ✓ Precargado: ${type}`);
    } catch (error) {
      console.warn(`[DICT] ⚠️ Error precargando ${type}: ${error.message}`);
    }
  });
  
  await Promise.allSettled(loadPromises);
  console.log(`[DICT] Precarga completada`);
}

// NUEVA FUNCIÓN: Limpiar caché de diccionarios
function clearDictionaryCache() {
  const cacheSize = Object.keys(dictionaryCache).length;
  Object.keys(dictionaryCache).forEach(key => delete dictionaryCache[key]);
  console.log(`[DICT] Caché limpiado: ${cacheSize} diccionarios removidos`);
}

// NUEVA FUNCIÓN: Obtener estadísticas de diccionarios
function getDictionaryStats() {
  const stats = {};
  
  for (const [type, fileName] of Object.entries(dictionaryMapping)) {
    const dictionary = dictionaryCache[fileName];
    stats[type] = {
      fileName,
      loaded: !!dictionary,
      wordCount: dictionary ? dictionary.length : 0,
      cached: !!dictionary
    };
  }
  
  return {
    totalTypes: Object.keys(dictionaryMapping).length,
    loadedTypes: Object.values(stats).filter(s => s.loaded).length,
    totalCachedWords: Object.values(dictionaryCache).reduce((sum, dict) => sum + dict.length, 0),
    details: stats
  };
}

module.exports = {
  getDictionaryForDocumentType,
  loadDictionary,
  enhanceSmallDictionary,
  getFallbackDictionary,
  validateDictionary,
  preloadDictionaries,
  clearDictionaryCache,
  getDictionaryStats
};