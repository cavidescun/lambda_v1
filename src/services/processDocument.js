const { getDictionaryForDocumentType } = require('./dictionaryService')
const { validateTextWithDictionary} = require('./validatorDocuments');
const { extractTextFromDocument } = require('./textract')
const { extractDataTyT } = require('./extractDataDocuments')

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
    FotocopiaDocumento: "N/A",
    DiplomayActaGradoBachiller: "N/A",
    DiplomayActaGradoTecnico: "N/A",
    DiplomayActaGradoTecnologo: "N/A",
    DiplomayActaGradoPregrado: "N/A",
    ResultadoSaberProDelNivelParaGrado: "N/A",
    ExamenIcfes_11: "N/A",
    RecibiDePagoDerechosDeGrado: "N/A",
    Encuesta_M0: "N/A",
    Acta_Homologacion: "N/A",
    EK: "Extraccion Manual",
    Autorizacion_tratamiento_de_datos: inputData.Autorizacion_tratamiento_de_datos || '',
    Num_Documento_Extraido: "Extraccion Manual",
    Institucion_Extraida: "Extraccion Manual",
    Programa_Extraido: "Extraccion Manual",
    Fecha_Presentacion_Extraida: "Extraccion Manual",
    Institucion_Valida: "N/A",
    Num_Doc_Valido: "N/A"
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

  await processDocumentType(documentMap, 'cedula', output, 'FotocopiaDocumento', inputData);
  await processDocumentType(documentMap, 'diploma_bachiller', output, 'DiplomayActaGradoBachiller', inputData);
  await processDocumentType(documentMap, 'diploma_tecnico', output, 'DiplomayActaGradoTecnico', inputData);
  await processDocumentType(documentMap, 'diploma_tecnologo', output, 'DiplomayActaGradoTecnologo', inputData);
  await processDocumentType(documentMap, 'titulo_profesional', output, 'DiplomayActaGradoPregrado', inputData);
  await processDocumentType(documentMap, 'prueba_tt', output, 'ResultadoSaberProDelNivelParaGrado', inputData);
  await processDocumentType(documentMap, 'icfes', output, 'ExamenIcfes_11', inputData);
  await processDocumentType(documentMap, 'recibo_pago', output, 'RecibiDePagoDerechosDeGrado', inputData);
  await processDocumentType(documentMap, 'encuesta_m0', output, 'Encuesta_M0', inputData);
  await processDocumentType(documentMap, 'acta_homologacion', output, 'Acta_Homologacion', inputData);
  
  return output;
}

async function processDocumentType(documentMap, docType, output, outputField, inputData){
  try {
    const file = documentMap[docType];
    if (!file) {
      console.log(`[PROCESS] No se encontró archivo para tipo: ${docType}`);
      output[outputField] = "N/A";
      return;
    }

    const extractedText = await extractTextFromDocument(file.path);
    const dictionary = await getDictionaryForDocumentType(docType);
    const isValid = await validateTextWithDictionary(extractedText, dictionary);

    if (isValid) {
      if (docType === 'prueba_tt') {
        const dataTyT = await extractDataTyT(extractedText);
        output.EK = dataTyT.registroEK;
        output.Num_Documento_Extraido = dataTyT.numDocumento;
        output.Fecha_Presentacion_Extraida = dataTyT.fechaPresentacion;
        output.Programa_Extraido = dataTyT.programa;
        output.Institucion_Extraida = dataTyT.institucion;
        if (dataTyT.numDocumento === inputData.Numero_de_Documento) {
          output.Num_Doc_Valido = 'Valido';
        } else {
          output.Num_Doc_Valido = 'Revision Manual';
        }
        const dictionaryCUN = await getDictionaryForDocumentType('cun_institutions');
        const validInstitution = await validateTextWithDictionary(dataTyT.institucion, dictionaryCUN);

        if (validInstitution) {
          output.Institucion_Valida = 'Valido';
        } else {
          output.Institucion_Valida = 'Revision Manual';
        }
      }
      
      output[outputField] = "Documento Valido";
    } else {
      output[outputField] = "Revision Manual";
    }
  } catch (error) {
    console.error(`[PROCESS] Error procesando ${docType}:`, error.message);
    output[outputField] = "Revision Manual";
  }
}

module.exports = {
  processDocuments
}