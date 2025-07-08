const fs = require("fs-extra");
const path = require("path");
const { PDFDocument } = require("pdf-lib");

async function splitPdfIntoPages(pdfPath) {
  try {
    console.log(`[PDF-SPLITTER] Analizando PDF: ${path.basename(pdfPath)}`);
    
    // Verificar si es un PDF
    if (!pdfPath.toLowerCase().endsWith('.pdf')) {
      console.log(`[PDF-SPLITTER] El archivo no es PDF, retornando archivo original`);
      return [pdfPath];
    }

    // Leer el PDF
    const pdfBuffer = await fs.readFile(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const pageCount = pdfDoc.getPageCount();
    
    console.log(`[PDF-SPLITTER] PDF tiene ${pageCount} página(s)`);

    // Si solo tiene una página, retornar el archivo original
    if (pageCount <= 1) {
      console.log(`[PDF-SPLITTER] PDF de una sola página, no requiere división`);
      return [pdfPath];
    }

    // Crear directorio para las páginas divididas
    const baseDir = path.dirname(pdfPath);
    const fileName = path.basename(pdfPath, '.pdf');
    const splitDir = path.join(baseDir, `${fileName}_pages`);
    await fs.ensureDir(splitDir);

    const splitPages = [];

    // Dividir cada página
    for (let i = 0; i < pageCount; i++) {
      try {
        console.log(`[PDF-SPLITTER] Procesando página ${i + 1}/${pageCount}`);
        
        // Crear nuevo documento con una sola página
        const newPdfDoc = await PDFDocument.create();
        const [page] = await newPdfDoc.copyPages(pdfDoc, [i]);
        newPdfDoc.addPage(page);

        // Generar buffer del nuevo PDF
        const newPdfBuffer = await newPdfDoc.save();

        // Guardar página individual
        const pageFileName = `${fileName}_page_${i + 1}.pdf`;
        const pageFilePath = path.join(splitDir, pageFileName);
        await fs.writeFile(pageFilePath, newPdfBuffer);

        splitPages.push(pageFilePath);
        
        console.log(`[PDF-SPLITTER] ✓ Página ${i + 1} guardada como: ${pageFileName}`);
      } catch (pageError) {
        console.error(`[PDF-SPLITTER] Error procesando página ${i + 1}:`, pageError.message);
        // Continuar con las siguientes páginas
      }
    }

    if (splitPages.length === 0) {
      console.warn(`[PDF-SPLITTER] No se pudieron dividir páginas, usando archivo original`);
      return [pdfPath];
    }

    console.log(`[PDF-SPLITTER] ✓ PDF dividido en ${splitPages.length} página(s)`);
    return splitPages;

  } catch (error) {
    console.error(`[PDF-SPLITTER] Error dividiendo PDF:`, error.message);
    console.log(`[PDF-SPLITTER] Usando archivo original como fallback`);
    return [pdfPath];
  }
}

async function getFileStats(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return {
      size: stats.size,
      sizeFormatted: formatBytes(stats.size),
      name: path.basename(filePath)
    };
  } catch (error) {
    return {
      size: 0,
      sizeFormatted: '0 B',
      name: path.basename(filePath),
      error: error.message
    };
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = {
  splitPdfIntoPages,
  getFileStats
};