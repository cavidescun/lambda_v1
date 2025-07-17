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

const fallbackDictionaries = {
  cedula: [
    "cedula", "documento", "identificacion", "cc", "c.c", "numero",
    "ciudadania", "identidad", "documento identidad", "cedula ciudadania"
  ],
  diploma_bachiller: [
    "bachiller", "diploma", "acta", "grado", "graduacion", "titulo",
    "bachillerato", "secundaria", "educacion media", "colegio"
  ],
  diploma_tecnico: [
    "tecnico", "diploma", "acta", "grado", "graduacion", "titulo",
    "tecnica", "instituto", "formacion tecnica"
  ],
  diploma_tecnologo: [
    "tecnologo", "diploma", "acta", "grado", "graduacion", "titulo",
    "tecnologia", "instituto", "formacion tecnologica"
  ],
  titulo_profesional: [
    "profesional", "titulo", "diploma", "acta", "grado", "graduacion",
    "universidad", "pregrado", "licenciatura"
  ],
  prueba_tt: [
    "saber", "pro", "icfes", "prueba", "examen", "test", "evaluacion",
    "competencias", "resultados", "puntaje"
  ],
  icfes: [
    "icfes", "saber", "11", "once", "prueba", "examen", "test",
    "evaluacion", "resultados", "puntaje"
  ],
  recibo_pago: [
   "860401734", "860401734-9"
  ],
  encuesta_m0: [
    "encuesta", "seguimiento", "momento", "evaluacion", "formulario",
    "cuestionario", "respuesta", "valoracion"
  ],
  acta_homologacion: [
    "homologacion", "acta", "reconocimiento", "validacion", "equivalencia",
    "convalidacion", "transferencia", "creditos"
  ],
  cun_institutions: [
    "corporacion unificada nacional", "cun", "educacion superior",
    "universidad", "institucion", "centro educativo"
  ]
};

async function getDictionaryForDocumentType(documentType) {
  console.log(`[DICT] Obteniendo diccionario para tipo: ${documentType}`);
  
  const dictionaryFileName = dictionaryMapping[documentType];

  if (!dictionaryFileName) {
    console.warn(`[DICT] No se encontró mapeo de diccionario para el tipo: ${documentType}`);
    
    // Usar diccionario de fallback si existe
    if (fallbackDictionaries[documentType]) {
      console.log(`[DICT] Usando diccionario de fallback para ${documentType}`);
      return fallbackDictionaries[documentType];
    }
    
    return [];
  }

  try {
    const dictionary = await loadDictionary(dictionaryFileName);
    
    // Si el diccionario está vacío, usar fallback
    if (!dictionary || dictionary.length === 0) {
      console.warn(`[DICT] Diccionario ${dictionaryFileName} vacío, usando fallback`);
      return fallbackDictionaries[documentType] || [];
    }
    
    // Si el diccionario es muy pequeño, combinarlo con fallback
    if (dictionary.length <= 2) {
      console.warn(`[DICT] Diccionario ${dictionaryFileName} muy pequeño (${dictionary.length} entradas), combinando con fallback`);
      const combinedDictionary = [...dictionary, ...(fallbackDictionaries[documentType] || [])];
      return [...new Set(combinedDictionary)]; // Eliminar duplicados
    }
    
    return dictionary;
  } catch (error) {
    console.error(`[DICT] Error cargando diccionario ${dictionaryFileName}:`, error.message);
    
    // En caso de error, usar fallback
    if (fallbackDictionaries[documentType]) {
      console.log(`[DICT] Usando diccionario de fallback debido a error`);
      return fallbackDictionaries[documentType];
    }
    
    return [];
  }
}

async function loadDictionary(dictionaryFileName) {
  try {
    // Verificar si ya está en cache
    if (dictionaryCache[dictionaryFileName]) {
      console.log(`[DICT] Usando diccionario desde cache: ${dictionaryFileName}`);
      return dictionaryCache[dictionaryFileName];
    }

    const dictionaryPath = path.join(
      process.cwd(),
      "dictionaries",
      dictionaryFileName
    );

    console.log(`[DICT] Intentando cargar diccionario: ${dictionaryPath}`);

    // Verificar si el archivo existe
    const exists = await fs.pathExists(dictionaryPath);
    if (!exists) {
      console.error(`[DICT] Archivo de diccionario no encontrado: ${dictionaryPath}`);
      return [];
    }

    // Leer el archivo
    const content = await fs.readFile(dictionaryPath, "utf8");
    
    if (!content || content.trim().length === 0) {
      console.error(`[DICT] Archivo de diccionario vacío: ${dictionaryFileName}`);
      return [];
    }

    // Procesar el contenido
    const keywords = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !line.startsWith("#")) // Filtrar comentarios
      .filter((line) => !line.startsWith("//")) // Filtrar comentarios
      .map((line) => line.toLowerCase()); // Normalizar a minúsculas

    if (keywords.length === 0) {
      console.error(`[DICT] No se encontraron palabras clave válidas en: ${dictionaryFileName}`);
      return [];
    }

    // Remover duplicados
    const uniqueKeywords = [...new Set(keywords)];
    
    // Cachear el resultado
    dictionaryCache[dictionaryFileName] = uniqueKeywords;
    
    console.log(`[DICT] Diccionario cargado exitosamente: ${dictionaryFileName} (${uniqueKeywords.length} palabras únicas)`);
    
    return uniqueKeywords;
    
  } catch (error) {
    console.error(`[DICT] Error cargando diccionario ${dictionaryFileName}:`, error.message);
    
    // Limpiar cache en caso de error
    if (dictionaryCache[dictionaryFileName]) {
      delete dictionaryCache[dictionaryFileName];
    }
    
    throw error;
  }
}

async function validateDictionaryFile(dictionaryFileName) {
  try {
    const dictionaryPath = path.join(
      process.cwd(),
      "dictionaries",
      dictionaryFileName
    );

    const exists = await fs.pathExists(dictionaryPath);
    if (!exists) {
      return {
        isValid: false,
        error: `Archivo no encontrado: ${dictionaryPath}`,
        path: dictionaryPath
      };
    }

    const stats = await fs.stat(dictionaryPath);
    if (stats.size === 0) {
      return {
        isValid: false,
        error: `Archivo vacío: ${dictionaryFileName}`,
        path: dictionaryPath,
        size: stats.size
      };
    }

    const content = await fs.readFile(dictionaryPath, "utf8");
    const lines = content.split("\n").filter(line => line.trim().length > 0);
    
    return {
      isValid: true,
      path: dictionaryPath,
      size: stats.size,
      lineCount: lines.length,
      validLines: lines.filter(line => !line.startsWith("#") && !line.startsWith("//")).length
    };
    
  } catch (error) {
    return {
      isValid: false,
      error: error.message,
      path: dictionaryFileName
    };
  }
}

async function validateAllDictionaries() {
  console.log(`[DICT] Validando todos los diccionarios...`);
  
  const results = {};
  
  for (const [docType, fileName] of Object.entries(dictionaryMapping)) {
    try {
      const validation = await validateDictionaryFile(fileName);
      results[docType] = {
        fileName,
        ...validation
      };
      
      if (validation.isValid) {
        console.log(`[DICT] ✓ ${docType}: ${fileName} (${validation.validLines} líneas válidas)`);
      } else {
        console.error(`[DICT] ✗ ${docType}: ${fileName} - ${validation.error}`);
      }
    } catch (error) {
      results[docType] = {
        fileName,
        isValid: false,
        error: error.message
      };
      console.error(`[DICT] ✗ ${docType}: Error validando ${fileName} - ${error.message}`);
    }
  }
  
  const totalDictionaries = Object.keys(results).length;
  const validDictionaries = Object.values(results).filter(r => r.isValid).length;
  const invalidDictionaries = totalDictionaries - validDictionaries;
  
  console.log(`[DICT] Resumen de validación: ${validDictionaries}/${totalDictionaries} diccionarios válidos`);
  
  if (invalidDictionaries > 0) {
    console.warn(`[DICT] ${invalidDictionaries} diccionarios tienen problemas - se usarán fallbacks`);
  }
  
  return {
    total: totalDictionaries,
    valid: validDictionaries,
    invalid: invalidDictionaries,
    results
  };
}

function clearDictionaryCache() {
  const cachedCount = Object.keys(dictionaryCache).length;
  Object.keys(dictionaryCache).forEach(key => {
    delete dictionaryCache[key];
  });
  console.log(`[DICT] Cache limpiado: ${cachedCount} diccionarios removidos`);
}

function getDictionaryCacheStatus() {
  const cached = Object.keys(dictionaryCache);
  return {
    cachedCount: cached.length,
    cachedDictionaries: cached,
    totalMappings: Object.keys(dictionaryMapping).length
  };
}

// Función para obtener estadísticas de un diccionario específico
async function getDictionaryStats(documentType) {
  try {
    const dictionary = await getDictionaryForDocumentType(documentType);
    const fileName = dictionaryMapping[documentType];
    
    return {
      documentType,
      fileName,
      wordCount: dictionary.length,
      averageWordLength: dictionary.reduce((sum, word) => sum + word.length, 0) / dictionary.length,
      uniqueWords: dictionary.length,
      longestWord: dictionary.reduce((longest, word) => word.length > longest.length ? word : longest, ''),
      shortestWord: dictionary.reduce((shortest, word) => word.length < shortest.length ? word : shortest, dictionary[0] || ''),
      usingFallback: !dictionaryMapping[documentType] || dictionaryCache[fileName] === undefined
    };
  } catch (error) {
    return {
      documentType,
      error: error.message,
      wordCount: 0,
      usingFallback: true
    };
  }
}

module.exports = {
  getDictionaryForDocumentType,
  loadDictionary,
  validateDictionaryFile,
  validateAllDictionaries,
  clearDictionaryCache,
  getDictionaryCacheStatus,
  getDictionaryStats
};