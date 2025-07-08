const AWS = require("aws-sdk");
const fs = require("fs-extra");
const path = require("path");
const { splitPdfIntoPages, getFileStats } = require("./pdfSplitter");

const textract = new AWS.Textract({
  httpOptions: {
    timeout: 50000,
    retries: 3,
  },
});

async function extractTextFromDocument(filePath) {
  try {
    console.log(`[TEXTRACT] Iniciando extracción de texto de: ${path.basename(filePath)}`);
    
    const fileStats = await getFileStats(filePath);
    console.log(`[TEXTRACT] Archivo: ${fileStats.name} (${fileStats.sizeFormatted})`);

    // Verificar si es HTML
    const documentBuffer = await fs.readFile(filePath);
    const headerCheck = documentBuffer.slice(0, 20).toString();
    if (
      headerCheck.startsWith("<!DOCTYPE") ||
      headerCheck.startsWith("<html") ||
      headerCheck.startsWith("<!do")
    ) {
      throw new Error("HTML_FILE_DETECTED");
    }

    // Dividir PDF en páginas si es necesario
    const pageFiles = await splitPdfIntoPages(filePath);
    console.log(`[TEXTRACT] Procesando ${pageFiles.length} archivo(s)`);

    let combinedText = "";
    const extractionResults = [];

    // Procesar cada página/archivo
    for (let i = 0; i < pageFiles.length; i++) {
      const pageFile = pageFiles[i];
      const pageNumber = i + 1;
      
      try {
        console.log(`[TEXTRACT] Extrayendo texto de página ${pageNumber}/${pageFiles.length}: ${path.basename(pageFile)}`);
        
        const pageText = await extractTextFromSingleFile(pageFile);
        
        if (pageText && pageText.trim().length > 0) {
          combinedText += pageText + " ";
          extractionResults.push({
            page: pageNumber,
            file: path.basename(pageFile),
            textLength: pageText.length,
            success: true
          });
          console.log(`[TEXTRACT] ✓ Página ${pageNumber}: ${pageText.length} caracteres extraídos`);
        } else {
          extractionResults.push({
            page: pageNumber,
            file: path.basename(pageFile),
            textLength: 0,
            success: false,
            error: "No se extrajo texto"
          });
          console.warn(`[TEXTRACT] ⚠️ Página ${pageNumber}: No se extrajo texto`);
        }
      } catch (pageError) {
        extractionResults.push({
          page: pageNumber,
          file: path.basename(pageFile),
          textLength: 0,
          success: false,
          error: pageError.message
        });
        console.error(`[TEXTRACT] ✗ Error en página ${pageNumber}:`, pageError.message);
      }
    }

    // Limpiar archivos de páginas divididas si se crearon
    if (pageFiles.length > 1) {
      await cleanupSplitFiles(pageFiles, filePath);
    }

    // Verificar resultados
    const successfulPages = extractionResults.filter(r => r.success).length;
    const totalTextLength = combinedText.trim().length;

    console.log(`[TEXTRACT] Resumen: ${successfulPages}/${pageFiles.length} páginas procesadas exitosamente`);
    console.log(`[TEXTRACT] Texto total extraído: ${totalTextLength} caracteres`);

    if (totalTextLength === 0) {
      throw new Error("NO_TEXT_EXTRACTED");
    }

    return combinedText.trim();

  } catch (error) {
    console.error(`[TEXTRACT] Error en extracción:`, error.message);
    throw error;
  }
}

async function extractTextFromSingleFile(filePath) {
  try {
    const documentBuffer = await fs.readFile(filePath);
    
    const params = {
      Document: {
        Bytes: documentBuffer,
      },
    };

    const result = await textract.detectDocumentText(params).promise();

    let extractedText = "";
    if (result.Blocks && result.Blocks.length > 0) {
      result.Blocks.forEach((block) => {
        if (block.BlockType === "LINE") {
          extractedText += block.Text + " ";
        }
      });
    }

    return extractedText.trim();
  } catch (error) {
    console.error(`[TEXTRACT] Error en archivo individual ${path.basename(filePath)}:`, error.message);
    throw error;
  }
}

async function cleanupSplitFiles(pageFiles, originalFile) {
  try {
    console.log(`[TEXTRACT] Limpiando archivos temporales de páginas divididas...`);
    
    for (const pageFile of pageFiles) {
      // Solo eliminar archivos que no sean el original
      if (pageFile !== originalFile) {
        try {
          await fs.remove(pageFile);
          console.log(`[TEXTRACT] ✓ Eliminado: ${path.basename(pageFile)}`);
        } catch (deleteError) {
          console.warn(`[TEXTRACT] ⚠️ No se pudo eliminar ${path.basename(pageFile)}:`, deleteError.message);
        }
      }
    }

    // Limpiar directorio de páginas si existe y está vacío
    if (pageFiles.length > 1) {
      const splitDir = path.dirname(pageFiles.find(f => f !== originalFile));
      if (splitDir && splitDir !== path.dirname(originalFile)) {
        try {
          const dirContents = await fs.readdir(splitDir);
          if (dirContents.length === 0) {
            await fs.remove(splitDir);
            console.log(`[TEXTRACT] ✓ Directorio temporal eliminado: ${path.basename(splitDir)}`);
          }
        } catch (dirError) {
          console.warn(`[TEXTRACT] ⚠️ No se pudo limpiar directorio ${splitDir}:`, dirError.message);
        }
      }
    }

    console.log(`[TEXTRACT] ✓ Limpieza de archivos temporales completada`);
  } catch (error) {
    console.error(`[TEXTRACT] Error durante limpieza:`, error.message);
  }
}

module.exports = {
  extractTextFromDocument,
};