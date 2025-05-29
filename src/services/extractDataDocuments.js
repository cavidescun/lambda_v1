async function extractDataTyT(text) {
  const extractedData = {
    numDocumento: "Extracción Manual",
    registroEK: "Extracción Manual",
    institucion: "Extracción Manual",
    programa: "Extracción Manual",
    fechaPresentacion: "Extracción Manual"
  };

  const docPatterns = [
    /Identificación:\s*C\.C\.\s*(\d{6,12})/gi,
    /Identificación:\s*(\d{6,12})/gi,
    /Identificación:\s*\n?\s*C\.C\.\s*(\d{6,12})/gi,
    /C\.C\.\s*(\d{6,12})/gi
  ];
  for (const pattern of docPatterns) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      extractedData.numDocumento = match[1];
      break;
    }
  }

  const ekPatterns = [
    /Número\s+de\s+registro:\s*(EK\d{10,15})/gi,
    /Número\s+de\s+registro:\s*\n?\s*(EK\d{10,15})/gi,
    /\b(EK\d{10,15})\b/gi
  ];
  for (const pattern of ekPatterns) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      extractedData.registroEK = match[1];
      break;
    }
  }

  const instPatterns = [
    /Institución\s+de\s+educación\s+superior:\s*([\s\S]+?)\n\s*Programa/gi,
    /Institución\s+de\s+educación\s+superior:\s*([^\n\r]+?)(?=\s*Programa|Educacion\s+Superior|$)/gi,
    /educación\s+superior:\s*([^\n\r]+?)(?=\s*Programa|$)/gi,
    /(Corporacion\s+Unificada\s+Nacional[^\n\r]*?)(?=\s*Programa|$)/gi
  ];
  for (const pattern of instPatterns) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      let institucion = match[1].replace(/\s+/g, ' ').trim();
      if (institucion.length > 10) {
        extractedData.institucion = institucion;
        break;
      }
    }
  }

  const progPatterns = [
    /Programa\s+Académico:\s*([^\n\r]+?)(?=\s*2\.|Reporte|$)/gi,
    /Programa\s+Académico:\s*\n?\s*([^\n\r]+?)(?=\s*2\.|$)/gi,
    /Programa\s+Académico:\s*([^\n\r]{10,})/gi,
    /(Tecnico\s+Profesional\s+[^\n\r]+?)(?=\s*2\.|$)/gi
  ];
  for (const pattern of progPatterns) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      let programa = match[1].replace(/\s+/g, ' ').trim();
      programa = programa.replace(/\s*\d+\.\s*$/, '').trim();
      if (programa.length > 10) {
        extractedData.programa = programa;
        break;
      }
    }
  }

  const datePatterns = [
    /Aplicación\s+del\s+examen:\s*(\d{1,2}\/\d{1,2}\/\d{4})/gi,
    /Aplicación\s+del\s+examen:\s*\n?\s*(\d{1,2}\/\d{1,2}\/\d{4})/gi,
    /Aplicación[^:]*:\s*(\d{1,2}\/\d{1,2}\/\d{4})/gi,
    /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/g
  ];
  for (let i = 0; i < datePatterns.length; i++) {
    const pattern = datePatterns[i];
    if (i < 3) {
      const match = pattern.exec(text);
      if (match && match[1]) {
        extractedData.fechaPresentacion = match[1];
        break;
      }
    } else {
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        const aplicacionIndex = text.indexOf('Aplicación del examen');
        if (aplicacionIndex !== -1) {
          for (const fecha of matches) {
            const fechaIndex = text.indexOf(fecha, aplicacionIndex);
            if (fechaIndex !== -1 && fechaIndex - aplicacionIndex < 100) {
              extractedData.fechaPresentacion = fecha;
              break;
            }
          }
        }
        if (extractedData.fechaPresentacion === "Extracción Manual" && matches[0]) {
          extractedData.fechaPresentacion = matches[0];
        }
        break;
      }
    }
  }

  return extractedData;
}


module.exports = {
  extractDataTyT
}