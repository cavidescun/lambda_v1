function extractDocumentUrls(inputData) {
  const documentUrls = {};
  
  const documentFields = [
    { field: 'Copia_de_cedula', key: 'cedula' },
    { field: 'Diploma_y_acta_de_bachiller', key: 'diploma_bachiller' },
    { field: 'Icfes', key: 'icfes' },
    { field: 'diploma_tecnico', key: 'diploma_tecnico' },
    { field: 'diploma_tecnologo', key: 'diploma_tecnologo' },
    { field: 'Titulo_profesional', key: 'titulo_profesional' },
    { field: 'Prueba_T_T', key: 'prueba_tt' },
    { field: 'Soporte_de_encuesta_momento_0', key: 'encuesta_m0' },
    { field: 'Acta_de_homologacion', key: 'acta_homologacion' },
    { field: 'Recibo_de_pago_derechos_de_grado', key: 'recibo_pago' }
  ];

  for (const doc of documentFields) {
    const fieldValue = inputData[doc.field];
    if (fieldValue && typeof fieldValue === 'string') {
      if (fieldValue.includes('drive.google.com') || fieldValue.includes('docs.google.com')) {
        documentUrls[doc.key] = fieldValue;
      }
    }
  }
  return documentUrls;
}

module.exports ={
  extractDocumentUrls
};