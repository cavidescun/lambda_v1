const { getDictionaryForDocumentType } = require('./dictionaryService');
const { validateTextWithDictionary} = require('./validatorDocuments');
const { extractTextFromDocument } = require('./textract');
const { extractDataTyT } = require('./extractDataDocuments');

async function processDocuments(inputData, downloadedFiles, documentUrls) {
  const output = {
    ID: inputData.ID,
    NombreCompleto: inputData.Nombre_completo || '',
    TipoDocumento: inputData.Tipo_de_documento || '',
    NumeroDocumento: inputData.Numero_de_Documento || '',
    Modalidad: inputData.Modalidad || '',
    NivelDeFormacionSolicitadoParaGrado: inputData.Nivel_de_formacion_del_cual_esta_solicitando_grado || '',
    ProgramaDelCualSolicita: inputData.Programa_del_cual_esta_solicitando_grado || '',
    CorreoInsitucional: inputData.Correo_electronico_institucional || '',
    CorreoPersonal: inputData.Correo_electronico_personal || '',
    FotocopiaDocumento:'Documento no adjunto',
    DiplomayActaGradoBachiller: 'Documento no adjunto',
    DiplomayActaGradoTecnico: 'Documento no adjunto',
    DiplomayActaGradoTecnologo: 'Documento no adjunto',
    DiplomayActaGradoPregrado: 'Documento no adjunto',
    ResultadoSaberProDelNivelParaGrado: 'Documento no adjunto',
    ExamenIcfes_11: 'Documento no adjunto',
    RecibiDePagoDerechosDeGrado: "Documento no adjunto",
    Encuesta_M0: "Documento no adjunto",
    Acta_Homologacion: "Documento no adjunto",
    EK: 'N/A',
    Autorizacion_tratamiento_de_datos: inputData.Autorizacion_tratamiento_de_datos || '',
    Num_Documento_Extraido: 'N/A',
    Institucion_Extraida:  'N/A',
    Programa_Extraido: 'N/A',
    Fecha_Presentacion_Extraida: 'N/A',
    Institucion_Valida: 'N/A',
    Num_Doc_Valido: 'N/A',
  };

  const documentMap = {};
  for (const file of downloadedFiles) {
    for (const [docType, url] of Object.entries(documentUrls)) {
      if (file.originalUrl === url) {
        documentMap[docType] = file;
        break;
      }
    }
  }

  await Promise.all([
  processDocumentType(documentMap, 'cedula', output, 'FotocopiaDocumento', inputData),
  processDocumentType(documentMap, 'diploma_bachiller', output, 'DiplomayActaGradoBachiller', inputData),
  processDocumentType(documentMap, 'diploma_tecnico', output, 'DiplomayActaGradoTecnico', inputData),
  processDocumentType(documentMap, 'diploma_tecnologo', output, 'DiplomayActaGradoTecnologo', inputData),
  processDocumentType(documentMap, 'titulo_profesional', output, 'DiplomayActaGradoPregrado', inputData),
  processDocumentType(documentMap, 'prueba_tt', output, 'ResultadoSaberProDelNivelParaGrado', inputData),
  processDocumentType(documentMap, 'icfes', output, 'ExamenIcfes_11', inputData),
  processDocumentType(documentMap, 'recibo_pago', output, 'RecibiDePagoDerechosDeGrado', inputData),
  processDocumentType(documentMap, 'encuesta_m0', output, 'Encuesta_M0', inputData),
  processDocumentType(documentMap, 'acta_homologacion', output, 'Acta_Homologacion', inputData),
]);

  console.log('[PROCESS] Procesamiento completado');
  return output;
}

async function processDocumentType(documentMap, docType, output, outputField, inputData){
  try {
    console.log(`[PROCESS] Procesando documento tipo: ${docType}`);
    
    const file = documentMap[docType];
    if (!file) {
      console.log(`[PROCESS] No se encontró archivo para tipo: ${docType}`);
      output[outputField] = "Documento no adjunto";
      return;
    }

    console.log(`[PROCESS] Archivo encontrado: ${file.fileName} (${formatBytes(file.size)})`);

    const extractedText = await extractTextFromDocument(file.path, docType);
    
    console.log(`[PROCESS] Texto extraído para ${docType}: ${extractedText.length} caracteres`);

    const dictionary = await getDictionaryForDocumentType(docType);
    const isValid = await validateTextWithDictionary(extractedText, dictionary);

    console.log(`[PROCESS] Validación ${docType}: ${isValid ? 'VÁLIDO' : 'INVÁLIDO'}`);

    if (isValid) {
      if (docType === 'prueba_tt') {
        console.log(`[PROCESS] Extrayendo datos específicos de TyT`);
        
        const dataTyT = await extractDataTyT(extractedText);

        output.EK = dataTyT.registroEK;
        output.Num_Documento_Extraido = dataTyT.numDocumento;
        output.Fecha_Presentacion_Extraida = dataTyT.fechaPresentacion;
        output.Programa_Extraido = dataTyT.programa;
        output.Institucion_Extraida = dataTyT.institucion;
        
        console.log(`[PROCESS] Datos TyT extraídos:`, {
          EK: dataTyT.registroEK,
          numDoc: dataTyT.numDocumento,
          fecha: dataTyT.fechaPresentacion,
          programa: dataTyT.programa.substring(0, 50) + '...',
          institucion: dataTyT.institucion.substring(0, 50) + '...'
        });

        if (dataTyT.numDocumento === inputData.Numero_de_Documento) {
          output.Num_Doc_Valido = 'Valido';
          console.log(`[PROCESS] Número de documento COINCIDE`);
        } else {
          output.Num_Doc_Valido = 'Revision Manual';
          console.log(`[PROCESS] Número de documento NO COINCIDE: ${dataTyT.numDocumento} vs ${inputData.Numero_de_Documento}`);
        }

        const dictionaryCUN = await getDictionaryForDocumentType('cun_institutions');
        const validInstitution = await validateTextWithDictionary(dataTyT.institucion, dictionaryCUN);

        if (validInstitution) {
          output.Institucion_Valida = 'Valido';
          console.log(`[PROCESS] Institución CUN VÁLIDA`);
        } else {
          output.Institucion_Valida = 'Revision Manual';
          console.log(`[PROCESS] Institución CUN REQUIERE REVISIÓN`);
        }
      }
      
      output[outputField] = "Documento Valido";
      console.log(`[PROCESS] ${docType} marcado como VÁLIDO`);
      
    } else {
      output[outputField] = "Revision Manual";
      console.log(`[PROCESS] ${docType} marcado para REVISIÓN MANUAL`);
    }
    
  } catch (error) {
    console.error(`[PROCESS] Error procesando ${docType}:`, error.message);

    if (error.message.includes('HTML_FILE_DETECTED')) {
      output[outputField] = "Archivo HTML detectado - Revision Manual";
    } else if (error.message.includes('NO_TEXT_EXTRACTED')) {
      output[outputField] = "Sin texto extraíble - Revision Manual";
    } else if (error.message.includes('PERMISSION_DENIED')) {
      output[outputField] = "Sin permisos de acceso - Revision Manual";
    } else if (error.message.includes('DOCUMENT_TOO_LARGE')) {
      output[outputField] = "Documento muy grande - Revision Manual";
    } else if (error.message.includes('UNSUPPORTED_FILE_TYPE')) {
      output[outputField] = "Tipo de archivo no soportado - Revision Manual";
    } else {
      output[outputField] = "Error en procesamiento - Revision Manual";
    }
    
    console.error(`[PROCESS] Detalle del error para ${docType}:`, {
      message: error.message,
      stack: error.stack?.substring(0, 200) + '...'
    });
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
  processDocuments
}