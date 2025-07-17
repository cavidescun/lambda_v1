async function validateTextWithDictionary(text, dictionary, minMatches = 1) {
  console.log(`[VALIDATOR] Iniciando validación robusta de texto`);
  
  try {
    const validationResult = validateInputParameters(text, dictionary, minMatches);
    if (!validationResult.isValid) {
      console.warn(`[VALIDATOR] Validación falló: ${validationResult.reason}`);
      return false;
    }
    
    const { normalizedText, sanitizedDictionary, effectiveMinMatches } = validationResult;
    
    console.log(`[VALIDATOR] Diccionario original: ${dictionary.length} entradas`);
    console.log(`[VALIDATOR] Primeras 5 entradas: ${dictionary.slice(0, 5).map(w => `"${w}"`).join(', ')}`);
    console.log(`[VALIDATOR] Diccionario sanitizado: ${sanitizedDictionary.length} palabras únicas de ${dictionary.length} originales`);
    console.log(`[VALIDATOR] Parámetros validados: texto=${normalizedText.length} chars, diccionario=${sanitizedDictionary.length} palabras, minMatches=${effectiveMinMatches}`);

    // CORECCIÓN: Verificar si el diccionario es muy pequeño y usar validación permisiva
    if (sanitizedDictionary.length < 5) {
      console.warn(`[VALIDATOR] Diccionario muy pequeño (${sanitizedDictionary.length} entradas), usando validación permisiva`);
      return await validateTextWithDictionarySimple(text, dictionary, 1);
    }

    const matchResult = await performTextMatching(normalizedText, sanitizedDictionary, effectiveMinMatches);
    
    console.log(`[VALIDATOR] Resultado: ${matchResult.isValid ? 'VÁLIDO' : 'INVÁLIDO'} (${matchResult.matchCount} coincidencias de ${effectiveMinMatches} requeridas)`);
    
    if (matchResult.matchedKeywords.length > 0) {
      console.log(`[VALIDATOR] Palabras coincidentes: ${matchResult.matchedKeywords.slice(0, 5).join(', ')}${matchResult.matchedKeywords.length > 5 ? '...' : ''}`);
    }
    
    return matchResult.isValid;
    
  } catch (error) {
    console.error(`[VALIDATOR] Error crítico en validación:`, error.message);
    // CORECCIÓN: Fallback a validación simple en caso de error
    console.log(`[VALIDATOR] Intentando validación simple como fallback`);
    return await validateTextWithDictionarySimple(text, dictionary, minMatches);
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

    sanitizedDictionary = sanitizeDictionary(dictionary);
    
    if (sanitizedDictionary.length === 0) {
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

      // CORREGIDO: Aceptar palabras más cortas para diccionarios pequeños
      if (keyword.length >= 1 && keyword.length <= 100) {
        if (/[a-záéíóúñü0-9]/.test(keyword)) {
          sanitized.push(keyword);
        }
      }
      
    } catch (itemError) {
      console.warn(`[VALIDATOR] Error procesando item del diccionario en índice ${i}:`, itemError.message);
    }
  }

  const uniqueKeywords = [...new Set(sanitized)];
  
  return uniqueKeywords;
}

async function performTextMatching(normalizedText, sanitizedDictionary, effectiveMinMatches) {
  let matchCount = 0;
  const matchedKeywords = [];
  const matchDetails = [];
  
  try {
    // Primera pasada: matching exacto
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

    // Si no se alcanza el mínimo, intentar fuzzy matching
    if (matchCount < effectiveMinMatches) {
      console.log(`[VALIDATOR] Matching exacto insuficiente (${matchCount}/${effectiveMinMatches}), intentando matching fuzzy`);
      
      const fuzzyResults = await performFuzzyMatching(normalizedText, sanitizedDictionary, effectiveMinMatches - matchCount);
      
      matchCount += fuzzyResults.additionalMatches;
      matchedKeywords.push(...fuzzyResults.keywords);
      matchDetails.push(...fuzzyResults.details);
      
      console.log(`[VALIDATOR] Matching fuzzy completado: ${fuzzyResults.additionalMatches} matches adicionales`);
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
        // 1. Matching sin acentos
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

        // 2. Matching de similaridad para palabras largas
        if (keyword.length >= 5) {
          const similarMatch = findSimilarWord(textWithoutAccents, keywordWithoutAccents);
          if (similarMatch.found && similarMatch.similarity > 0.75) {
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

        // 3. Matching por partes para frases
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

        // 4. NUEVO: Matching parcial para palabras largas
        if (keyword.length >= 6) {
          const partialMatches = findPartialMatches(normalizedText, keyword);
          if (partialMatches.length > 0) {
            fuzzyResults.additionalMatches++;
            fuzzyResults.keywords.push(keyword);
            fuzzyResults.details.push({
              keyword,
              method: 'fuzzy-partial',
              originalKeyword: keyword,
              partialMatches
            });
            continue;
          }
        }
        
      } catch (fuzzyKeywordError) {
        console.warn(`[VALIDATOR] Error en fuzzy matching para '${keyword}':`, fuzzyKeywordError.message);
      }
    }
    
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

function findPartialMatches(text, keyword) {
  const matches = [];
  try {
    // Buscar subsecuencias del keyword en el texto
    const minLength = Math.max(3, Math.floor(keyword.length * 0.6));
    
    for (let i = 0; i <= keyword.length - minLength; i++) {
      const substring = keyword.substring(i, i + minLength);
      if (text.includes(substring)) {
        matches.push({
          substring,
          position: text.indexOf(substring),
          coverage: substring.length / keyword.length
        });
      }
    }
  } catch (error) {
    console.warn(`[VALIDATOR] Error en partial matching:`, error.message);
  }
  return matches;
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
        if (similarity > 0.75 && similarity > bestMatch.similarity) {
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

// CORREGIDA: Validación simple mejorada
async function validateTextWithDictionarySimple(text, dictionary, minMatches = 1) {
  console.log(`[VALIDATOR] Usando validación simple como fallback`);
  
  try {
    if (!text || !dictionary || dictionary.length === 0) {
      return false;
    }
    
    const normalizedText = String(text).toLowerCase();
    let matchCount = 0;
    const foundKeywords = [];
    
    for (const keyword of dictionary) {
      try {
        const normalizedKeyword = String(keyword).toLowerCase().trim();
        if (normalizedKeyword && normalizedKeyword.length > 0) {
          
          // Búsqueda exacta
          if (normalizedText.includes(normalizedKeyword)) {
            matchCount++;
            foundKeywords.push(normalizedKeyword);
            if (matchCount >= minMatches) {
              console.log(`[VALIDATOR] Validación simple exitosa: encontradas ${foundKeywords.join(', ')}`);
              return true;
            }
          }
          
          // NUEVO: Búsqueda sin acentos para validación simple
          else {
            const keywordNoAccents = removeAccents(normalizedKeyword);
            const textNoAccents = removeAccents(normalizedText);
            
            if (textNoAccents.includes(keywordNoAccents)) {
              matchCount++;
              foundKeywords.push(normalizedKeyword + ' (sin acentos)');
              if (matchCount >= minMatches) {
                console.log(`[VALIDATOR] Validación simple exitosa (sin acentos): encontradas ${foundKeywords.join(', ')}`);
                return true;
              }
            }
          }
        }
      } catch (keywordError) {
        continue;
      }
    }
    
    console.log(`[VALIDATOR] Validación simple: ${matchCount} matches encontrados de ${minMatches} requeridos`);
    if (foundKeywords.length > 0) {
      console.log(`[VALIDATOR] Palabras encontradas: ${foundKeywords.join(', ')}`);
    }
    
    return matchCount >= minMatches;
    
  } catch (error) {
    console.error(`[VALIDATOR] Error en validación simple:`, error.message);
    return false;
  }
}

// NUEVA: Validación específica para diccionarios muy pequeños
async function validateTextWithSmallDictionary(text, dictionary) {
  console.log(`[VALIDATOR] Validación especial para diccionario pequeño (${dictionary.length} entradas)`);
  
  try {
    if (!text || !dictionary || dictionary.length === 0) {
      return false;
    }
    
    const normalizedText = String(text).toLowerCase();
    
    // Para diccionarios muy pequeños, ser más permisivo
    for (const keyword of dictionary) {
      try {
        const normalizedKeyword = String(keyword).toLowerCase().trim();
        
        if (normalizedKeyword.length > 0) {
          // Búsqueda muy permisiva
          if (normalizedText.includes(normalizedKeyword) ||
              removeAccents(normalizedText).includes(removeAccents(normalizedKeyword))) {
            console.log(`[VALIDATOR] Match encontrado en diccionario pequeño: "${normalizedKeyword}"`);
            return true;
          }
          
          // Para palabras muy cortas, buscar como parte de palabras más largas
          if (normalizedKeyword.length >= 3) {
            const words = normalizedText.split(/\s+/);
            for (const word of words) {
              if (word.includes(normalizedKeyword) || 
                  removeAccents(word).includes(removeAccents(normalizedKeyword))) {
                console.log(`[VALIDATOR] Match parcial encontrado: "${normalizedKeyword}" en "${word}"`);
                return true;
              }
            }
          }
        }
      } catch (keywordError) {
        continue;
      }
    }
    
    console.log(`[VALIDATOR] No se encontraron matches en diccionario pequeño`);
    return false;
    
  } catch (error) {
    console.error(`[VALIDATOR] Error en validación de diccionario pequeño:`, error.message);
    return false;
  }
}

async function validateTextWithDictionaryRobust(text, dictionary, minMatches = 1) {
  try {
    // CORREGIDO: Verificar tamaño del diccionario primero
    if (dictionary && dictionary.length < 5) {
      console.warn(`[VALIDATOR] Diccionario muy pequeño (${dictionary.length} entradas), usando validación permisiva`);
      return await validateTextWithSmallDictionary(text, dictionary);
    }
    
    return await validateTextWithDictionary(text, dictionary, minMatches);
  } catch (mainError) {
    console.warn(`[VALIDATOR] Validación principal falló, usando fallback:`, mainError.message);
    
    try {
      // Intentar validación simple
      return await validateTextWithDictionarySimple(text, dictionary, minMatches);
    } catch (fallbackError) {
      console.error(`[VALIDATOR] Fallback también falló:`, fallbackError.message);
      
      // Último recurso: validación muy permisiva
      if (dictionary && dictionary.length > 0) {
        console.log(`[VALIDATOR] Intentando validación de último recurso`);
        return await validateTextWithSmallDictionary(text, dictionary);
      }
      
      return false;
    }
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
  validateTextWithSmallDictionary,
  validateDictionaryIntegrity,
  diagnoseValidationIssue
};