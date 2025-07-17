async function validateTextWithDictionary(text, dictionary, minMatches = 1) {
  console.log(`[VALIDATOR] Iniciando validación robusta de texto`);
  
  try {
    const validationResult = validateInputParameters(text, dictionary, minMatches);
    if (!validationResult.isValid) {
      console.warn(`[VALIDATOR] Validación falló: ${validationResult.reason}`);
      return false;
    }
    
    const { normalizedText, sanitizedDictionary, effectiveMinMatches } = validationResult;
    
    console.log(`[VALIDATOR] Parámetros validados: texto=${normalizedText.length} chars, diccionario=${sanitizedDictionary.length} palabras, minMatches=${effectiveMinMatches}`);

    const matchResult = await performTextMatching(normalizedText, sanitizedDictionary, effectiveMinMatches);
    
    console.log(`[VALIDATOR] Resultado: ${matchResult.isValid ? 'VÁLIDO' : 'INVÁLIDO'} (${matchResult.matchCount} coincidencias de ${effectiveMinMatches} requeridas)`);
    
    if (matchResult.matchedKeywords.length > 0) {
      console.log(`[VALIDATOR] Palabras coincidentes: ${matchResult.matchedKeywords.slice(0, 5).join(', ')}${matchResult.matchedKeywords.length > 5 ? '...' : ''}`);
    }
    
    return matchResult.isValid;
    
  } catch (error) {
    console.error(`[VALIDATOR] Error crítico en validación:`, error.message);
    return false;
  }
}

function validateInputParameters(text, dictionary, minMatches) {
  try {
    let normalizedText;
    if (!text) {
      return { isValid: false, reason: 'Texto es null, undefined o vacío' };
    }
    
    if (typeof text !== 'string') {
      try {
        normalizedText = String(text).toLowerCase().trim();
      } catch (conversionError) {
        return { isValid: false, reason: 'No se puede convertir texto a string' };
      }
    } else {
      normalizedText = text.toLowerCase().trim();
    }
    
    if (normalizedText.length === 0) {
      return { isValid: false, reason: 'Texto está vacío después de normalización' };
    }

    let sanitizedDictionary;
    if (!dictionary) {
      return { isValid: false, reason: 'Diccionario es null o undefined' };
    }
    
    if (!Array.isArray(dictionary)) {
      return { isValid: false, reason: 'Diccionario no es un array' };
    }
    
    if (dictionary.length === 0) {
      return { isValid: false, reason: 'Diccionario está vacío' };
    }

    // Agregar logging para debug
    console.log(`[VALIDATOR] Diccionario original: ${dictionary.length} entradas`);
    console.log(`[VALIDATOR] Primeras 5 entradas: ${dictionary.slice(0, 5).map(item => `"${item}"`).join(', ')}`);

    sanitizedDictionary = sanitizeDictionary(dictionary);
    
    if (sanitizedDictionary.length === 0) {
      console.error(`[VALIDATOR] Diccionario vacío después de sanitización. Entradas originales:`);
      dictionary.forEach((item, index) => {
        console.error(`[VALIDATOR]   ${index}: "${item}" (tipo: ${typeof item}, length: ${item?.length || 'N/A'})`);
      });
      return { isValid: false, reason: 'Diccionario no contiene palabras válidas después de sanitización' };
    }

    let effectiveMinMatches;
    if (typeof minMatches !== 'number' || isNaN(minMatches) || minMatches < 1) {
      console.warn(`[VALIDATOR] minMatches inválido (${minMatches}), usando valor por defecto 1`);
      effectiveMinMatches = 1;
    } else {
      effectiveMinMatches = Math.max(1, Math.floor(minMatches));
    }

    if (effectiveMinMatches > sanitizedDictionary.length) {
      console.warn(`[VALIDATOR] minMatches (${effectiveMinMatches}) mayor que diccionario (${sanitizedDictionary.length}), ajustando`);
      effectiveMinMatches = sanitizedDictionary.length;
    }
    
    return {
      isValid: true,
      normalizedText,
      sanitizedDictionary,
      effectiveMinMatches
    };
    
  } catch (error) {
    return { isValid: false, reason: `Error en validación de parámetros: ${error.message}` };
  }
}

function sanitizeDictionary(dictionary) {
  const sanitized = [];
  
  for (let i = 0; i < dictionary.length; i++) {
    try {
      const item = dictionary[i];
      
      if (item === null || item === undefined) {
        console.warn(`[VALIDATOR] Saltando item null/undefined en índice ${i}`);
        continue;
      }
      
      let keyword;
      if (typeof item === 'string') {
        keyword = item.trim().toLowerCase();
      } else {
        try {
          keyword = String(item).trim().toLowerCase();
        } catch (conversionError) {
          console.warn(`[VALIDATOR] No se pudo convertir item del diccionario en índice ${i}: ${conversionError.message}`);
          continue;
        }
      }

      // Ser más permisivo con la longitud mínima
      if (keyword.length >= 1 && keyword.length <= 100) {
        // Verificar que contiene al menos una letra
        if (/[a-záéíóúñüçA-ZÁÉÍÓÚÑÜÇ0-9]/.test(keyword)) {
          sanitized.push(keyword);
        } else {
          console.warn(`[VALIDATOR] Saltando keyword sin caracteres válidos en índice ${i}: "${keyword}"`);
        }
      } else {
        console.warn(`[VALIDATOR] Saltando keyword con longitud inválida en índice ${i}: "${keyword}" (length: ${keyword.length})`);
      }
      
    } catch (itemError) {
      console.warn(`[VALIDATOR] Error procesando item del diccionario en índice ${i}:`, itemError.message);
    }
  }

  const uniqueKeywords = [...new Set(sanitized)];
  
  console.log(`[VALIDATOR] Diccionario sanitizado: ${uniqueKeywords.length} palabras únicas de ${dictionary.length} originales`);
  
  // Si el diccionario sigue vacío, intentar un enfoque más permisivo
  if (uniqueKeywords.length === 0) {
    console.warn(`[VALIDATOR] Diccionario vacío después de sanitización, intentando enfoque permisivo`);
    
    for (let i = 0; i < dictionary.length; i++) {
      try {
        const item = dictionary[i];
        if (item && String(item).trim().length > 0) {
          const permissiveKeyword = String(item).trim().toLowerCase();
          if (permissiveKeyword.length > 0) {
            uniqueKeywords.push(permissiveKeyword);
            console.log(`[VALIDATOR] Agregado con enfoque permisivo: "${permissiveKeyword}"`);
          }
        }
      } catch (permissiveError) {
        console.warn(`[VALIDATOR] Error en enfoque permisivo para índice ${i}:`, permissiveError.message);
      }
    }
    
    console.log(`[VALIDATOR] Después de enfoque permisivo: ${uniqueKeywords.length} palabras`);
  }
  
  return uniqueKeywords;
}

async function performTextMatching(normalizedText, sanitizedDictionary, effectiveMinMatches) {
  let matchCount = 0;
  const matchedKeywords = [];
  const matchDetails = [];
  
  try {
    for (const keyword of sanitizedDictionary) {
      try {
        if (normalizedText.includes(keyword)) {
          matchCount++;
          matchedKeywords.push(keyword);
          matchDetails.push({
            keyword,
            method: 'exact',
            positions: findAllOccurrences(normalizedText, keyword)
          });
          if (matchCount >= effectiveMinMatches) {
            break;
          }
        }
      } catch (keywordError) {
        console.warn(`[VALIDATOR] Error procesando keyword '${keyword}':`, keywordError.message);
      }
    }

    if (matchCount < effectiveMinMatches) {
      console.log(`[VALIDATOR] Matching exacto insuficiente (${matchCount}/${effectiveMinMatches}), intentando matching fuzzy`);
      
      const fuzzyResults = await performFuzzyMatching(normalizedText, sanitizedDictionary, effectiveMinMatches - matchCount);
      
      matchCount += fuzzyResults.additionalMatches;
      matchedKeywords.push(...fuzzyResults.keywords);
      matchDetails.push(...fuzzyResults.details);
    }
    
    const isValid = matchCount >= effectiveMinMatches;
    
    return {
      isValid,
      matchCount,
      matchedKeywords: [...new Set(matchedKeywords)],
      matchDetails,
      strategy: matchCount > 0 ? (matchDetails.some(d => d.method === 'fuzzy') ? 'exact+fuzzy' : 'exact') : 'none'
    };
    
  } catch (matchingError) {
    console.error(`[VALIDATOR] Error en matching:`, matchingError.message);
    return {
      isValid: false,
      matchCount: 0,
      matchedKeywords: [],
      matchDetails: [],
      strategy: 'error',
      error: matchingError.message
    };
  }
}

async function performFuzzyMatching(normalizedText, sanitizedDictionary, neededMatches) {
  const fuzzyResults = {
    additionalMatches: 0,
    keywords: [],
    details: []
  };
  
  try {
    for (const keyword of sanitizedDictionary) {
      if (fuzzyResults.additionalMatches >= neededMatches) {
        break;
      }
      
      try {
        const keywordWithoutAccents = removeAccents(keyword);
        const textWithoutAccents = removeAccents(normalizedText);
        
        if (textWithoutAccents.includes(keywordWithoutAccents) && !normalizedText.includes(keyword)) {
          fuzzyResults.additionalMatches++;
          fuzzyResults.keywords.push(keyword);
          fuzzyResults.details.push({
            keyword,
            method: 'fuzzy-accents',
            originalKeyword: keyword,
            normalizedKeyword: keywordWithoutAccents
          });
          continue;
        }

        if (keyword.length >= 6) {
          const similarMatch = findSimilarWord(textWithoutAccents, keywordWithoutAccents);
          if (similarMatch.found) {
            fuzzyResults.additionalMatches++;
            fuzzyResults.keywords.push(keyword);
            fuzzyResults.details.push({
              keyword,
              method: 'fuzzy-similar',
              originalKeyword: keyword,
              foundMatch: similarMatch.match,
              similarity: similarMatch.similarity
            });
            continue;
          }
        }

        if (keyword.includes(' ')) {
          const wordParts = keyword.split(' ').filter(part => part.length > 2);
          const foundParts = wordParts.filter(part => normalizedText.includes(part));
          
          if (foundParts.length >= Math.ceil(wordParts.length * 0.6)) {
            fuzzyResults.additionalMatches++;
            fuzzyResults.keywords.push(keyword);
            fuzzyResults.details.push({
              keyword,
              method: 'fuzzy-parts',
              originalKeyword: keyword,
              foundParts,
              totalParts: wordParts.length
            });
            continue;
          }
        }
        
      } catch (fuzzyKeywordError) {
        console.warn(`[VALIDATOR] Error en fuzzy matching para '${keyword}':`, fuzzyKeywordError.message);
      }
    }
    
    console.log(`[VALIDATOR] Matching fuzzy completado: ${fuzzyResults.additionalMatches} matches adicionales`);
    
  } catch (fuzzyError) {
    console.error(`[VALIDATOR] Error en fuzzy matching:`, fuzzyError.message);
  }
  
  return fuzzyResults;
}

function findAllOccurrences(text, keyword) {
  const positions = [];
  try {
    let index = text.indexOf(keyword);
    while (index !== -1) {
      positions.push(index);
      index = text.indexOf(keyword, index + 1);
    }
  } catch (error) {
    console.warn(`[VALIDATOR] Error finding occurrences:`, error.message);
  }
  return positions;
}

function removeAccents(text) {
  try {
    return text
      .replace(/[áàâãä]/g, 'a')
      .replace(/[éèêë]/g, 'e')
      .replace(/[íìîï]/g, 'i')
      .replace(/[óòôõö]/g, 'o')
      .replace(/[úùûü]/g, 'u')
      .replace(/[ñ]/g, 'n')
      .replace(/[ç]/g, 'c');
  } catch (error) {
    return text;
  }
}

function findSimilarWord(text, keyword) {
  try {
    const words = text.split(/\s+/);
    let bestMatch = { found: false, match: '', similarity: 0 };
    
    for (const word of words) {
      if (word.length >= keyword.length - 2 && word.length <= keyword.length + 2) {
        const similarity = calculateSimpleSimilarity(word, keyword);
        if (similarity > 0.8 && similarity > bestMatch.similarity) {
          bestMatch = {
            found: true,
            match: word,
            similarity
          };
        }
      }
    }
    
    return bestMatch;
  } catch (error) {
    return { found: false, match: '', similarity: 0 };
  }
}

function calculateSimpleSimilarity(word1, word2) {
  try {
    if (word1 === word2) return 1;
    
    const longer = word1.length > word2.length ? word1 : word2;
    const shorter = word1.length > word2.length ? word2 : word1;
    
    let matches = 0;
    for (let i = 0; i < shorter.length; i++) {
      if (longer[i] === shorter[i]) {
        matches++;
      }
    }
    
    return matches / longer.length;
  } catch (error) {
    return 0;
  }
}

async function validateTextWithDictionarySimple(text, dictionary, minMatches = 1) {
  console.log(`[VALIDATOR] Usando validación simple como fallback`);
  
  try {
    if (!text || !dictionary || dictionary.length === 0) {
      return false;
    }
    
    const normalizedText = String(text).toLowerCase();
    let matchCount = 0;
    
    for (const keyword of dictionary) {
      try {
        const normalizedKeyword = String(keyword).toLowerCase().trim();
        if (normalizedKeyword && normalizedText.includes(normalizedKeyword)) {
          matchCount++;
          if (matchCount >= minMatches) {
            return true;
          }
        }
      } catch (keywordError) {
        continue;
      }
    }
    
    return matchCount >= minMatches;
    
  } catch (error) {
    console.error(`[VALIDATOR] Error en validación simple:`, error.message);
    return false;
  }
}

async function validateTextWithDictionaryRobust(text, dictionary, minMatches = 1) {
  try {
    // Manejar casos especiales de documentos no procesables
    if (text && text.includes('DOCUMENTO_NO_PROCESABLE') || text.includes('DOCUMENTO_PDF_NO_PROCESABLE')) {
      console.log(`[VALIDATOR] Documento no procesable detectado, usando validación basada en nombre`);
      return validateDocumentByFilename(text, dictionary);
    }
    
    // Si el diccionario está vacío o es muy pequeño, usar validación más permisiva
    if (!dictionary || dictionary.length === 0) {
      console.warn(`[VALIDATOR] Diccionario vacío o null, retornando false`);
      return false;
    }
    
    if (dictionary.length <= 2) {
      console.warn(`[VALIDATOR] Diccionario muy pequeño (${dictionary.length} entradas), usando validación permisiva`);
      return await validateTextWithDictionarySimple(text, dictionary, minMatches);
    }
    
    return await validateTextWithDictionary(text, dictionary, minMatches);
  } catch (mainError) {
    console.warn(`[VALIDATOR] Validación principal falló, usando fallback:`, mainError.message);
    
    try {
      return await validateTextWithDictionarySimple(text, dictionary, minMatches);
    } catch (fallbackError) {
      console.error(`[VALIDATOR] Fallback también falló:`, fallbackError.message);
      return false;
    }
  }
}

function validateDocumentByFilename(text, dictionary) {
  try {
    console.log(`[VALIDATOR] Validando documento no procesable por nombre de archivo`);
    
    // Extraer información del texto de error
    const textLower = text.toLowerCase();
    
    // Buscar coincidencias de palabras clave en el nombre del archivo
    const fileNameMatches = [];
    
    for (const keyword of dictionary) {
      const keywordLower = String(keyword).toLowerCase().trim();
      if (keywordLower && textLower.includes(keywordLower)) {
        fileNameMatches.push(keyword);
      }
    }
    
    // También verificar términos relacionados comunes
    const commonTerms = {
      'bachiller': ['bachiller', 'diploma', 'acta', 'grado'],
      'tecnologo': ['tecnologo', 'tecnol', 'diploma', 'acta'],
      'tecnico': ['tecnico', 'tecnica', 'diploma', 'acta'],
      'cedula': ['cedula', 'identidad', 'documento', 'cc'],
      'pago': ['pago', 'recibo', 'derechos', 'grado'],
      'encuesta': ['encuesta', 'seguimiento', 'confirmacion'],
      'icfes': ['icfes', 'saber', 'resultados', 'examen'],
      'prueba': ['resultados', 'ek', 'prueba', 'saber']
    };
    
    for (const [category, terms] of Object.entries(commonTerms)) {
      if (textLower.includes(category)) {
        for (const term of terms) {
          const matchingKeywords = dictionary.filter(keyword => 
            String(keyword).toLowerCase().includes(term)
          );
          fileNameMatches.push(...matchingKeywords);
        }
      }
    }
    
    const uniqueMatches = [...new Set(fileNameMatches)];
    
    if (uniqueMatches.length > 0) {
      console.log(`[VALIDATOR] Validación por nombre exitosa: ${uniqueMatches.length} coincidencias encontradas`);
      console.log(`[VALIDATOR] Coincidencias: ${uniqueMatches.slice(0, 3).join(', ')}`);
      return true;
    }
    
    console.log(`[VALIDATOR] No se encontraron coincidencias en el nombre del archivo`);
    return false;
    
  } catch (error) {
    console.error(`[VALIDATOR] Error en validación por nombre:`, error.message);
    return false;
  }
}

async function validateDocumentWithExtractionError(text, dictionary, documentType) {
  try {
    console.log(`[VALIDATOR] Validando documento con error de extracción: ${documentType}`);
    
    // Si el texto indica un error de procesamiento, intentar validación alternativa
    if (text.includes('DOCUMENTO_NO_PROCESABLE') || 
        text.includes('error-fallback') || 
        text.includes('Formato no soportado')) {
      
      // Para algunos tipos de documento, podemos ser más permisivos
      const permissiveTypes = ['recibo_pago', 'encuesta_m0', 'acta_homologacion'];
      
      if (permissiveTypes.includes(documentType)) {
        console.log(`[VALIDATOR] Aplicando validación permisiva para tipo: ${documentType}`);
        return await validateDocumentByFilename(text, dictionary);
      }
    }
    
    // Para documentos críticos, requerir validación estricta
    return await validateTextWithDictionaryRobust(text, dictionary, 1);
    
  } catch (error) {
    console.error(`[VALIDATOR] Error en validación con error de extracción:`, error.message);
    return false;
  }
}


function validateDictionaryIntegrity(dictionary, dictionaryName = 'unknown') {
  try {
    console.log(`[VALIDATOR] Validando integridad del diccionario: ${dictionaryName}`);
    
    if (!dictionary) {
      throw new Error(`Diccionario ${dictionaryName} es null o undefined`);
    }
    
    if (!Array.isArray(dictionary)) {
      throw new Error(`Diccionario ${dictionaryName} no es un array`);
    }
    
    if (dictionary.length === 0) {
      throw new Error(`Diccionario ${dictionaryName} está vacío`);
    }

    let validEntries = 0;
    let invalidEntries = 0;
    
    for (let i = 0; i < dictionary.length; i++) {
      const entry = dictionary[i];
      
      if (entry === null || entry === undefined) {
        invalidEntries++;
        continue;
      }
      
      if (typeof entry === 'string' && entry.trim().length > 0) {
        validEntries++;
      } else {
        invalidEntries++;
      }
    }
    
    const validPercentage = (validEntries / dictionary.length) * 100;
    
    console.log(`[VALIDATOR] Diccionario ${dictionaryName}: ${validEntries} válidas, ${invalidEntries} inválidas (${validPercentage.toFixed(1)}% válidas)`);
    
    if (validEntries === 0) {
      throw new Error(`Diccionario ${dictionaryName} no contiene entradas válidas`);
    }
    
    if (validPercentage < 50) {
      console.warn(`[VALIDATOR] Diccionario ${dictionaryName} tiene menos del 50% de entradas válidas`);
    }
    
    return {
      isValid: true,
      totalEntries: dictionary.length,
      validEntries,
      invalidEntries,
      validPercentage
    };
    
  } catch (error) {
    console.error(`[VALIDATOR] Error validando diccionario ${dictionaryName}:`, error.message);
    return {
      isValid: false,
      error: error.message,
      totalEntries: dictionary?.length || 0,
      validEntries: 0,
      invalidEntries: dictionary?.length || 0,
      validPercentage: 0
    };
  }
}

function diagnoseValidationIssue(text, dictionary, minMatches = 1) {
  console.log(`[VALIDATOR] Ejecutando diagnóstico de validación`);
  
  const diagnosis = {
    textValid: false,
    textLength: 0,
    dictionaryValid: false,
    dictionaryLength: 0,
    minMatchesValid: false,
    potentialMatches: [],
    recommendations: []
  };
  
  try {
    if (text && typeof text === 'string') {
      diagnosis.textValid = true;
      diagnosis.textLength = text.length;
    } else {
      diagnosis.recommendations.push('Texto inválido o no es string');
    }

    if (dictionary && Array.isArray(dictionary) && dictionary.length > 0) {
      diagnosis.dictionaryValid = true;
      diagnosis.dictionaryLength = dictionary.length;
    } else {
      diagnosis.recommendations.push('Diccionario inválido, vacío o no es array');
    }

    if (typeof minMatches === 'number' && minMatches >= 1) {
      diagnosis.minMatchesValid = true;
    } else {
      diagnosis.recommendations.push('minMatches debe ser un número >= 1');
    }

    if (diagnosis.textValid && diagnosis.dictionaryValid) {
      const normalizedText = text.toLowerCase();
      
      for (let i = 0; i < Math.min(dictionary.length, 10); i++) {
        const keyword = String(dictionary[i]).toLowerCase().trim();
        if (normalizedText.includes(keyword)) {
          diagnosis.potentialMatches.push(keyword);
        }
      }
      
      if (diagnosis.potentialMatches.length === 0) {
        diagnosis.recommendations.push('No se encontraron coincidencias obvias entre texto y diccionario');
      }
    }
    
  } catch (error) {
    diagnosis.error = error.message;
    diagnosis.recommendations.push(`Error durante diagnóstico: ${error.message}`);
  }
  
  console.log(`[VALIDATOR] Diagnóstico:`, diagnosis);
  return diagnosis;
}

module.exports = {
  validateTextWithDictionary: validateTextWithDictionaryRobust,
  validateTextWithDictionarySimple,
  validateDictionaryIntegrity,
  diagnoseValidationIssue,
  validateDocumentByFilename,
  validateDocumentWithExtractionError
};