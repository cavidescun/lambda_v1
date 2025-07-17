const fs = require("fs-extra");
const path = require("path");
const { PDFDocument } = require("pdf-lib");

const MAX_PAGES_TO_PROCESS = 3;

async function splitPdfIntoPages(pdfPath) {
  try {
    console.log(`[PDF-SPLITTER] Analizando PDF: ${path.basename(pdfPath)}`);
    
    if (!pdfPath.toLowerCase().endsWith('.pdf')) {
      console.log(`[PDF-SPLITTER] El archivo no es PDF, retornando archivo original`);
      return [pdfPath];
    }
    
    const pdfBuffer = await fs.readFile(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const totalPageCount = pdfDoc.getPageCount();
    
    console.log(`[PDF-SPLITTER] PDF tiene ${totalPageCount} página(s) total(es)`);

    const pagesToProcess = Math.min(totalPageCount, MAX_PAGES_TO_PROCESS);
    
    if (totalPageCount > MAX_PAGES_TO_PROCESS) {
      console.log(`[PDF-SPLITTER] ⚠️ Limitando procesamiento a las primeras ${MAX_PAGES_TO_PROCESS} páginas de ${totalPageCount} totales`);
    }

    if (pagesToProcess <= 1) {
      console.log(`[PDF-SPLITTER] PDF de una sola página o límite alcanzado, no requiere división`);
      return [pdfPath];
    }

    const baseDir = path.dirname(pdfPath);
    const fileName = path.basename(pdfPath, '.pdf');
    const splitDir = path.join(baseDir, `${fileName}_pages`);
    await fs.ensureDir(splitDir);

    const splitPages = [];

    for (let i = 0; i < pagesToProcess; i++) {
      try {
        console.log(`[PDF-SPLITTER] Procesando página ${i + 1}/${pagesToProcess} (de ${totalPageCount} totales)`);

        const newPdfDoc = await PDFDocument.create();
        const [page] = await newPdfDoc.copyPages(pdfDoc, [i]);
        newPdfDoc.addPage(page);

        const newPdfBuffer = await newPdfDoc.save();

        const pageFileName = `${fileName}_page_${i + 1}.pdf`;
        const pageFilePath = path.join(splitDir, pageFileName);
        await fs.writeFile(pageFilePath, newPdfBuffer);

        splitPages.push(pageFilePath);
        
        console.log(`[PDF-SPLITTER] ✓ Página ${i + 1} guardada como: ${pageFileName}`);
      } catch (pageError) {
        console.error(`[PDF-SPLITTER] Error procesando página ${i + 1}:`, pageError.message);
      }
    }

    if (splitPages.length === 0) {
      console.warn(`[PDF-SPLITTER] No se pudieron dividir páginas, usando archivo original`);
      return [pdfPath];
    }

    const skippedPages = totalPageCount - pagesToProcess;
    if (skippedPages > 0) {
      console.log(`[PDF-SPLITTER] ✓ PDF dividido en ${splitPages.length} página(s) procesadas. ${skippedPages} página(s) omitidas por límite`);
    } else {
      console.log(`[PDF-SPLITTER] ✓ PDF dividido en ${splitPages.length} página(s) - todas las páginas procesadas`);
    }

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

function getMaxPagesLimit() {
  return MAX_PAGES_TO_PROCESS;
}

function setMaxPagesLimit(newLimit) {
  if (newLimit && typeof newLimit === 'number' && newLimit > 0) {
    console.log(`[PDF-SPLITTER] Límite de páginas cambiado de ${MAX_PAGES_TO_PROCESS} a ${newLimit}`);
    return newLimit;
  }
  return MAX_PAGES_TO_PROCESS;
}

module.exports = {
  splitPdfIntoPages,
  getFileStats,
  getMaxPagesLimit,
  setMaxPagesLimit
};