const AWS = require("aws-sdk");
const fs = require("fs-extra");

const textract = new AWS.Textract({
  httpOptions: {
    timeout: 120000, // Aumentado para documentos multipágina
    retries: 5,
  },
});

const DOCUMENT_FEATURES = {
  cedula: ['FORMS', 'SIGNATURES'],
  diploma_bachiller: ['FORMS', 'TABLES'],
  diploma_tecnico: ['FORMS', 'TABLES'],
  diploma_tecnologo: ['FORMS', 'TABLES'],
  titulo_profesional: ['FORMS', 'TABLES'],
  prueba_tt: ['FORMS', 'TABLES', 'LAYOUT'],
  icfes: ['FORMS', 'TABLES', 'LAYOUT'],
  recibo_pago: ['FORMS', 'TABLES'],
  encuesta_m0: ['FORMS'],
  acta_homologacion: ['FORMS', 'TABLES']
};

const SIZE_LIMITS = {
  SYNC_BYTES: 5 * 1024 * 1024,
  ASYNC_BYTES: 500 * 1024 * 1024
};

async function extractTextFromDocument(filePath, documentType = null, options = {}) {
  try {
    console.log(`[TEXTRACT] Iniciando extracción para: ${filePath}`);
    
    const documentBuffer = await fs.readFile(filePath);
    await validateDocument(documentBuffer, filePath);

    const useAnalyze = shouldUseAnalyzeDocument(documentBuffer.length, documentType);
    
    let result;
    if (useAnalyze) {
      result = await extractWithAnalyzeDocument(documentBuffer, documentType, options);
    } else {
      result = await extractWithDetectDocument(documentBuffer, options);
    }
    
    return result;
    
  } catch (error) {
    console.error(`[TEXTRACT] Error en extracción:`, error.message);
    throw error;
  }
}

async function validateDocument(documentBuffer, filePath) {
  const headerCheck = documentBuffer.slice(0, 20).toString();
  if (headerCheck.startsWith("<!DOCTYPE") || 
      headerCheck.startsWith("<html") || 
      headerCheck.startsWith("<!do")) {
    throw new Error("HTML_FILE_DETECTED");
  }

  if (documentBuffer.length < 100) {
    throw new Error("DOCUMENT_TOO_SMALL");
  }
  
  if (documentBuffer.length > SIZE_LIMITS.ASYNC_BYTES) {
    throw new Error("DOCUMENT_TOO_LARGE");
  }

  const fileType = detectFileType(documentBuffer);
  if (!['PDF', 'PNG', 'JPEG', 'TIFF'].includes(fileType)) {
    throw new Error(`UNSUPPORTED_FILE_TYPE: ${fileType}`);
  }
  
  console.log(`[TEXTRACT] Documento validado - Tipo: ${fileType}, Tamaño: ${formatBytes(documentBuffer.length)}`);
}

function detectFileType(buffer) {
  const header = buffer.slice(0, 8);
  
  if (header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46) {
    return 'PDF';
  }
  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) {
    return 'PNG';
  }
  if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) {
    return 'JPEG';
  }
  if ((header[0] === 0x49 && header[1] === 0x49) || (header[0] === 0x4D && header[1] === 0x4D)) {
    return 'TIFF';
  }
  
  return 'UNKNOWN';
}

function shouldUseAnalyzeDocument(fileSize, documentType) {
  const structuredDocuments = ['diploma_bachiller', 'diploma_tecnico', 'diploma_tecnologo', 
                              'titulo_profesional', 'prueba_tt', 'icfes', 'recibo_pago'];

  if (documentType && structuredDocuments.includes(documentType)) {
    return true;
  }

  if (fileSize < 1024 * 1024) { // 1MB
    return false;
  }
  
  return true;
}

async function extractWithAnalyzeDocument(documentBuffer, documentType, options = {}) {
  try {
    console.log(`[TEXTRACT] Usando analyzeDocument para tipo: ${documentType}`);
    
    const features = getFeatureTypesForDocument(documentType);
    
    const params = {
      Document: {
        Bytes: documentBuffer,
      },
      FeatureTypes: features
    };

    let result;
    if (documentBuffer.length <= SIZE_LIMITS.SYNC_BYTES) {
      result = await textract.analyzeDocument(params).promise();
    } else {
      result = await analyzeDocumentLarge(documentBuffer, features);
    }

    return processAnalyzeResult(result, documentType, options);
    
  } catch (error) {
    console.warn(`[TEXTRACT] Error en analyzeDocument, fallback a detectDocument:`, error.message);
    return await extractWithDetectDocument(documentBuffer, options);
  }
}

function getFeatureTypesForDocument(documentType) {
  if (!documentType || !DOCUMENT_FEATURES[documentType]) {
    return ['FORMS']; // Default
  }
  return DOCUMENT_FEATURES[documentType];
}

function processAnalyzeResult(result, documentType, options = {}) {
  const extractedData = {
    text: '',
    confidence: 0,
    forms: [],
    tables: [],
    layout: [],
    pages: [], // Nueva propiedad para manejar páginas
    metadata: {
      totalBlocks: result.Blocks ? result.Blocks.length : 0,
      documentType: documentType,
      extractionMethod: 'analyzeDocument',
      totalPages: 0
    }
  };
  
  if (!result.Blocks || result.Blocks.length === 0) {
    throw new Error("NO_TEXT_EXTRACTED");
  }
  
  let confidenceSum = 0;
  let confidenceCount = 0;
  
  // Agrupar bloques por página
  const pageBlocks = groupBlocksByPage(result.Blocks);
  extractedData.metadata.totalPages = Object.keys(pageBlocks).length;
  
  console.log(`[TEXTRACT] Procesando ${extractedData.metadata.totalPages} páginas`);

  // Procesar cada página
  Object.keys(pageBlocks).forEach(pageNumber => {
    const blocks = pageBlocks[pageNumber];
    const pageData = {
      pageNumber: parseInt(pageNumber),
      text: '',
      forms: [],
      tables: [],
      layout: [],
      confidence: 0
    };
    
    let pageConfidenceSum = 0;
    let pageConfidenceCount = 0;
    
    blocks.forEach(block => {
      switch (block.BlockType) {
        case 'LINE':
          pageData.text += block.Text + ' ';
          extractedData.text += block.Text + ' ';
          if (block.Confidence) {
            confidenceSum += block.Confidence;
            confidenceCount++;
            pageConfidenceSum += block.Confidence;
            pageConfidenceCount++;
          }
          break;
          
        case 'KEY_VALUE_SET':
          if (block.EntityTypes && block.EntityTypes.includes('KEY')) {
            const keyValue = processKeyValuePair(block, blocks);
            pageData.forms.push(keyValue);
            extractedData.forms.push({...keyValue, page: parseInt(pageNumber)});
          }
          break;
          
        case 'TABLE':
          const table = processTable(block, blocks);
          pageData.tables.push(table);
          extractedData.tables.push({...table, page: parseInt(pageNumber)});
          break;
          
        case 'LAYOUT':
          const layout = {
            type: block.LayoutType,
            text: block.Text,
            confidence: block.Confidence,
            geometry: block.Geometry
          };
          pageData.layout.push(layout);
          extractedData.layout.push({...layout, page: parseInt(pageNumber)});
          break;
      }
    });

    pageData.confidence = pageConfidenceCount > 0 ? pageConfidenceSum / pageConfidenceCount : 0;
    pageData.text = pageData.text.trim();
    extractedData.pages.push(pageData);
    
    console.log(`[TEXTRACT] Página ${pageNumber} procesada - Confianza: ${pageData.confidence.toFixed(2)}%`);
  });

  extractedData.confidence = confidenceCount > 0 ? confidenceSum / confidenceCount : 0;
  extractedData.text = extractedData.text.trim();
  
  if (extractedData.text.length === 0) {
    throw new Error("NO_TEXT_EXTRACTED");
  }
  
  console.log(`[TEXTRACT] Extracción completada - Confianza total: ${extractedData.confidence.toFixed(2)}%`);

  // Retornar según las opciones
  if (options.returnFullData) {
    return extractedData;
  } else if (options.returnByPages) {
    return extractedData.pages;
  } else {
    return extractedData.text;
  }
}

function groupBlocksByPage(blocks) {
  const pageBlocks = {};
  
  blocks.forEach(block => {
    const pageNumber = block.Page || 1; // Default a página 1 si no está especificada
    
    if (!pageBlocks[pageNumber]) {
      pageBlocks[pageNumber] = [];
    }
    
    pageBlocks[pageNumber].push(block);
  });
  
  return pageBlocks;
}

function processKeyValuePair(keyBlock, allBlocks) {
  const keyText = getBlockText(keyBlock, allBlocks);
  let valueText = '';

  if (keyBlock.Relationships) {
    const valueRelation = keyBlock.Relationships.find(rel => rel.Type === 'VALUE');
    if (valueRelation && valueRelation.Ids) {
      const valueBlocks = valueRelation.Ids.map(id => 
        allBlocks.find(block => block.Id === id)
      ).filter(Boolean);
      
      valueText = valueBlocks.map(block => getBlockText(block, allBlocks)).join(' ');
    }
  }
  
  return {
    key: keyText.trim(),
    value: valueText.trim(),
    confidence: keyBlock.Confidence
  };
}

function processTable(tableBlock, allBlocks) {
  const table = {
    rows: [],
    confidence: tableBlock.Confidence
  };
  
  if (tableBlock.Relationships) {
    const cellRelation = tableBlock.Relationships.find(rel => rel.Type === 'CHILD');
    if (cellRelation && cellRelation.Ids) {
      const cells = cellRelation.Ids.map(id => 
        allBlocks.find(block => block.Id === id && block.BlockType === 'CELL')
      ).filter(Boolean);

      const cellMatrix = {};
      cells.forEach(cell => {
        const row = cell.RowIndex || 1;
        const col = cell.ColumnIndex || 1;
        
        if (!cellMatrix[row]) cellMatrix[row] = {};
        cellMatrix[row][col] = getBlockText(cell, allBlocks);
      });

      Object.keys(cellMatrix).sort((a, b) => parseInt(a) - parseInt(b)).forEach(rowNum => {
        const row = cellMatrix[rowNum];
        const rowData = [];
        Object.keys(row).sort((a, b) => parseInt(a) - parseInt(b)).forEach(colNum => {
          rowData.push(row[colNum]);
        });
        table.rows.push(rowData);
      });
    }
  }
  
  return table;
}

function getBlockText(block, allBlocks) {
  let text = block.Text || '';
  
  if (block.Relationships) {
    const childRelation = block.Relationships.find(rel => rel.Type === 'CHILD');
    if (childRelation && childRelation.Ids) {
      const childTexts = childRelation.Ids.map(id => {
        const childBlock = allBlocks.find(b => b.Id === id);
        return childBlock ? (childBlock.Text || '') : '';
      }).filter(Boolean);
      
      if (childTexts.length > 0) {
        text = childTexts.join(' ');
      }
    }
  }
  
  return text;
}

async function analyzeDocumentLarge(documentBuffer, features) {
  const params = {
    Document: {
      Bytes: documentBuffer,
    },
    FeatureTypes: features
  };

  const extendedTextract = new AWS.Textract({
    httpOptions: {
      timeout: 300000, // 5 minutos para documentos grandes
      retries: 3,
    },
  });
  
  return await extendedTextract.analyzeDocument(params).promise();
}

async function extractWithDetectDocument(documentBuffer, options = {}) {
  console.log(`[TEXTRACT] Usando detectDocumentText (método básico)`);
  
  const params = {
    Document: {
      Bytes: documentBuffer,
    },
  };
  
  const result = await textract.detectDocumentText(params).promise();
  
  // Agrupar bloques por página
  const pageBlocks = groupBlocksByPage(result.Blocks || []);
  const totalPages = Object.keys(pageBlocks).length;
  
  console.log(`[TEXTRACT] Procesando ${totalPages} páginas con detectDocumentText`);
  
  let extractedText = "";
  let confidenceSum = 0;
  let confidenceCount = 0;
  const pages = [];
  
  Object.keys(pageBlocks).forEach(pageNumber => {
    const blocks = pageBlocks[pageNumber];
    let pageText = "";
    let pageConfidenceSum = 0;
    let pageConfidenceCount = 0;
    
    blocks.forEach((block) => {
      if (block.BlockType === "LINE") {
        pageText += block.Text + " ";
        extractedText += block.Text + " ";
        if (block.Confidence) {
          confidenceSum += block.Confidence;
          confidenceCount++;
          pageConfidenceSum += block.Confidence;
          pageConfidenceCount++;
        }
      }
    });
    
    const pageConfidence = pageConfidenceCount > 0 ? pageConfidenceSum / pageConfidenceCount : 0;
    pages.push({
      pageNumber: parseInt(pageNumber),
      text: pageText.trim(),
      confidence: pageConfidence
    });
    
    console.log(`[TEXTRACT] Página ${pageNumber} procesada - Confianza: ${pageConfidence.toFixed(2)}%`);
  });
  
  const avgConfidence = confidenceCount > 0 ? confidenceSum / confidenceCount : 0;
  console.log(`[TEXTRACT] Confianza promedio total: ${avgConfidence.toFixed(2)}%`);
  
  const trimmedText = extractedText.trim();
  if (trimmedText.length === 0) {
    throw new Error("NO_TEXT_EXTRACTED");
  }

  if (options.returnByPages) {
    return pages;
  } else {
    return trimmedText;
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function extractTextByPages(filePath, documentType = null) {
  return await extractTextFromDocument(filePath, documentType, { returnByPages: true });
}

async function extractFullData(filePath, documentType = null) {
  return await extractTextFromDocument(filePath, documentType, { returnFullData: true });
}

async function extractTextWithDocumentType(filePath, documentType) {
  return await extractTextFromDocument(filePath, documentType);
}

module.exports = {
  extractTextFromDocument,
  extractTextWithDocumentType,
  extractTextByPages,
  extractFullData
};