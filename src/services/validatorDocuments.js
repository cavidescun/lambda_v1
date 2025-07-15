async function validateTextWithDictionary(text, dictionary, minMatches = 1) {
  console.log(`[VALIDATOR] Iniciando validación robusta de texto`);
  
  try {
    // Validación de parámetros de entrada
    const validationResult = validateInputParameters(text, dictionary, minMatches);
    if (!validationResult.isValid) {
      console.warn(`[VALIDATOR] Validación falló: ${validationResult.reason}`);
      return false;
    }
    
    const { normalizedText, sanitizedDictionary, effectiveMinMatches } = validationResult;
    
    console.log(`[VALIDATOR] Parámetros validados: texto=${normalizedText.length} chars, diccionario=${sanitizedDictionary.length} palabras, minMatches=${effectiveMinMatches}`);
    
    // Realizar validación con múltiples estrategias
    const matchResult = await performTextMatching(normalizedText, sanitizedDictionary, effectiveMinMatches);
    
    console.log(`[VALIDATOR] Resultado: ${matchResult.isValid ? 'VÁLIDO' : 'INVÁLIDO'} (${matchResult.matchCount} coincidencias de ${effectiveMinMatches} requeridas)`);
    
    if (matchResult.matchedKeywords.length > 0) {
      console.log(`[VALIDATOR] Palabras coincidentes: ${matchResult.matchedKeywords.slice(0, 5).join(', ')}${matchResult.matchedKeywords.length > 5 ? '...' : ''}`);
    }
    
    return matchResult.isValid;
    
  } catch (error) {
    console.error(`[VALIDATOR] Error crítico en validación:`, error.message);
    // En caso de error, retornar false como valor seguro
    return false;
  }
}

// Función para validar parámetros de entrada
function validateInputParameters(text, dictionary, minMatches) {
  try {
    // Validar texto
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
    
    // Validar diccionario
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
    
    // Sanitizar diccionario
    sanitizedDictionary = sanitizeDictionary(dictionary);
    
    if (sanitizedDictionary.length === 0) {
      return { isValid: false, reason: 'Diccionario no contiene palabras válidas después de sanitización' };
    }
    
    // Validar minMatches
    let effectiveMinMatches;
    if (typeof minMatches !== 'number' || isNaN(minMatches) || minMatches < 1) {
      console.warn(`[VALIDATOR] minMatches inválido (${minMatches}), usando valor por defecto 1`);
      effectiveMinMatches = 1;
    } else {
      effectiveMinMatches = Math.max(1, Math.floor(minMatches));
    }
    
    // Ajustar minMatches si es mayor que el diccionario disponible
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

// Función para sanitizar diccionario
function sanitizeDictionary(dictionary) {
  const sanitized = [];
  
  for (let i = 0; i < dictionary.length; i++) {
    try {
      const item = dictionary[i];
      
      if (item === null || item === undefined) {
        continue;
      }
      
      let keyword;
      if (typeof item === 'string') {
        keyword = item.trim().toLowerCase();
      } else {
        try {
          keyword = String(item).trim().toLowerCase();
        } catch (conversionError) {
          console.warn(`[VALIDATOR] No se pudo convertir item del diccionario en índice ${i}`);
          continue;
        }
      }
      
      // Filtrar palabras muy cortas o inválidas
      if (keyword.length >= 2 && keyword.length <= 100) {
        // Verificar que contiene al menos una letra
        if (/[a-záéíóúñü]/.test(keyword)) {
          sanitized.push(keyword);
        }
      }
      
    } catch (itemError) {
      console.warn(`[VALIDATOR] Error procesando item del diccionario en índice ${i}:`, itemError.message);
    }
  }
  
  // Remover duplicados
  const uniqueKeywords = [...new Set(sanitized)];
  
  console.log(`[VALIDATOR] Diccionario sanitizado: ${uniqueKeywords.length} palabras únicas de ${dictionary.length} originales`);
  
  return uniqueKeywords;
}

// Función para realizar el matching de texto
async function performTextMatching(normalizedText, sanitizedDictionary, effectiveMinMatches) {
  let matchCount = 0;
  const matchedKeywords = [];
  const matchDetails = [];
  
  try {
    // Estrategia 1: Matching exacto (más rápido)
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
          
          // Optimización: salir temprano si ya tenemos suficientes matches
          if (matchCount >= effectiveMinMatches) {
            break;
          }
        }
      } catch (keywordError) {
        console.warn(`[VALIDATOR] Error procesando keyword '${keyword}':`, keywordError.message);
      }
    }
    
    // Si no tenemos suficientes matches, intentar matching fuzzy
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
      matchedKeywords: [...new Set(matchedKeywords)], // Remover duplicados
      matchDetails,
      strategy: matchCount > 0 ? (matchDetails.some(d => d.method === 'fuzzy') ? 'exact+fuzzy' : 'exact') : 'none'
    };
    
  } catch (matchingError) {
    console.error(`[VALIDATOR] Error en matching:`, matchingError.message);
    
    // Retornar resultado de emergencia
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

// Función para matching fuzzy (tolerante a errores menores)
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
        // Estrategia fuzzy 1: Buscar palabra sin acentos
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
        
        // Estrategia fuzzy 2: Buscar palabras similares (solo para palabras largas)
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
        
        // Estrategia fuzzy 3: Buscar palabra dividida (por espacios o caracteres)
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

// Función para encontrar todas las ocurrencias de una palabra
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

// Función para remover acentos
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

// Función para encontrar palabras similares (simple similarity)
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

// Función para calcular similitud simple
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

// Función de validación alternativa más simple (fallback)
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
        // Continuar con la siguiente palabra
        continue;
      }
    }
    
    return matchCount >= minMatches;
    
  } catch (error) {
    console.error(`[VALIDATOR] Error en validación simple:`, error.message);
    return false;
  }
}

// Función principal con fallback automático
async function validateTextWithDictionaryRobust(text, dictionary, minMatches = 1) {
  try {
    // Intentar validación completa primero
    return await validateTextWithDictionary(text, dictionary, minMatches);
  } catch (mainError) {
    console.warn(`[VALIDATOR] Validación principal falló, usando fallback:`, mainError.message);
    
    try {
      // Usar validación simple como fallback
      return await validateTextWithDictionarySimple(text, dictionary, minMatches);
    } catch (fallbackError) {
      console.error(`[VALIDATOR] Fallback también falló:`, fallbackError.message);
      // En último caso, retornar false
      return false;
    }
  }
}

// Función para validar integridad de diccionario
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
    
    // Verificar contenido del diccionario
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

// Función de diagnóstico para debugging
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
    // Diagnosticar texto
    if (text && typeof text === 'string') {
      diagnosis.textValid = true;
      diagnosis.textLength = text.length;
    } else {
      diagnosis.recommendations.push('Texto inválido o no es string');
    }
    
    // Diagnosticar diccionario
    if (dictionary && Array.isArray(dictionary) && dictionary.length > 0) {
      diagnosis.dictionaryValid = true;
      diagnosis.dictionaryLength = dictionary.length;
    } else {
      diagnosis.recommendations.push('Diccionario inválido, vacío o no es array');
    }
    
    // Diagnosticar minMatches
    if (typeof minMatches === 'number' && minMatches >= 1) {
      diagnosis.minMatchesValid = true;
    } else {
      diagnosis.recommendations.push('minMatches debe ser un número >= 1');
    }
    
    // Buscar coincidencias potenciales si ambos parámetros son válidos
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
  diagnoseValidationIssue
};