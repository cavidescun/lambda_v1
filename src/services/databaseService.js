const sql = require("mssql");

const connection = null;
const dbConfig = {
  user: process.env.SQLSERVER_USERNAME || "",
  password: process.env.SQLSERVER_PASSWORD || "",
  server: process.env.SQLSERVER_HOST || "",
  database: process.env.SQLSERVER_DATABASE || "",
  port: Number(process.env.SQLSERVER_PORT),
  options: {
    encrypt: true,
    trustServerCertificate: true,
  },
};

async function getConnection() {
  try {
    if (!connection) {
      connection = await sql.connect(dbConfig);
    }
    return connection;
  } catch (error) {
    throw new Error("[DB]Error en coneccion a base de datos", error.message);
  }
}

async function closeConnection() {
  try {
    if (connection) {
      await connection.close();
      connection = null;
    }
  } catch (error) {
    console.error("[DB] Error al cerrar conexion", error.message);
  }
}

async function insertDBData(data) {
  try {
    const conectDB = await getConnection();
    const request = conectDB.request();

     const insertQuery = `
      INSERT INTO Grados.Documentacion_Mayo2025 (
        ID,
        NombreCompleto,
        TipoDocumento,
        NumeroDocumento,
        Modalidad,
        NivelDeFormacionSolicitadoParaGrado,
        ProgramaDelCualSolicita,
        CorreoInsitucional,
        CorreoPersonal,
        FotocopiaDocumento,
        DiplomayActaGradoBachiller,
        DiplomayActaGradoTecnico,
        DiplomayActaGradoTecnologo,
        DiplomayActaGradoPregrado,
        ResultadoSaberProDelNivelParaGrado,
        ExamenIcfes_11,
        RecibiDePagoDerechosDeGrado,
        Encuesta_M0,
        Acta_Homologacion,
        EK,
        Autorizacion_tratamiento_de_datos,
        Num_Documento_Extraido,
        Institucion_Extraida,
        Programa_Extraido,
        Fecha_Presentacion_Extraida,
        Institucion_Valida,
        Num_Doc_Valido,
        FechaProcesamiento
      ) VALUES (
        @ID,
        @NombreCompleto,
        @TipoDocumento,
        @NumeroDocumento,
        @Modalidad,
        @NivelDeFormacionSolicitadoParaGrado,
        @ProgramaDelCualSolicita,
        @CorreoInsitucional,
        @CorreoPersonal,
        @FotocopiaDocumento,
        @DiplomayActaGradoBachiller,
        @DiplomayActaGradoTecnico,
        @DiplomayActaGradoTecnologo,
        @DiplomayActaGradoPregrado,
        @ResultadoSaberProDelNivelParaGrado,
        @ExamenIcfes_11,
        @RecibiDePagoDerechosDeGrado,
        @Encuesta_M0,
        @Acta_Homologacion,
        @EK,
        @Autorizacion_tratamiento_de_datos,
        @Num_Documento_Extraido,
        @Institucion_Extraida,
        @Programa_Extraido,
        @Fecha_Presentacion_Extraida,
        @Institucion_Valida,
        @Num_Doc_Valido,
        @FechaProcesamiento
      )
    `;
    
    request.input('ID', sql.NVarChar(255), data.ID || '');
    request.input('NombreCompleto', sql.NVarChar(255), data.NombreCompleto);
    request.input('TipoDocumento', sql.NVarChar(255), data.TipoDocumento);
    request.input('NumeroDocumento', sql.NVarChar(255), data.NumeroDocumento);
    request.input('Modalidad', sql.NVarChar(255), data.Modalidad);
    request.input('NivelDeFormacionSolicitadoParaGrado', sql.NVarChar(255), data.NivelDeFormacionSolicitadoParaGrado);
    request.input('ProgramaDelCualSolicita', sql.NVarChar(255), data.ProgramaDelCualSolicita);
    request.input('CorreoInsitucional', sql.NVarChar(255), data.CorreoInsitucional);
    request.input('CorreoPersonal', sql.NVarChar(255), data.CorreoPersonal);
    request.input('FotocopiaDocumento', sql.NVarChar(255), data.FotocopiaDocumento);
    request.input('DiplomayActaGradoBachiller', sql.NVarChar(255), data.DiplomayActaGradoBachiller);
    request.input('DiplomayActaGradoTecnico', sql.NVarChar(255), data.DiplomayActaGradoTecnico);
    request.input('DiplomayActaGradoTecnologo', sql.NVarChar(255), data.DiplomayActaGradoTecnologo);
    request.input('DiplomayActaGradoPregrado', sql.NVarChar(255), data.DiplomayActaGradoPregrado);
    request.input('ResultadoSaberProDelNivelParaGrado', sql.NVarChar(255), data.ResultadoSaberProDelNivelParaGrado);
    request.input('ExamenIcfes_11', sql.NVarChar(255), data.ExamenIcfes_11);
    request.input('RecibiDePagoDerechosDeGrado', sql.NVarChar(255), data.RecibiDePagoDerechosDeGrado);
    request.input('Encuesta_M0', sql.NVarChar(255), data.Encuesta_M0);
    request.input('Acta_Homologacion', sql.NVarChar(255), data.Acta_Homologacion);
    request.input('EK', sql.NVarChar(255), data.EK);
    request.input('Autorizacion_tratamiento_de_datos', sql.NVarChar(255), data.Autorizacion_tratamiento_de_datos);
    request.input('Num_Documento_Extraido', sql.NVarChar(255), data.Num_Documento_Extraido);
    request.input('Institucion_Extraida', sql.NVarChar(255), data.Institucion_Extraida);
    request.input('Programa_Extraido', sql.NVarChar(255), data.Programa_Extraido);
    request.input('Fecha_Presentacion_Extraida', sql.NVarChar(255), data.Fecha_Presentacion_Extraida);
    request.input('Institucion_Valida', sql.NVarChar(255), data.Institucion_Valida);
    request.input('Num_Doc_Valido', sql.NVarChar(255), data.Num_Doc_Valido);

    const result = await request.query(insertQuery);
    closeConnection();
    return {
      success: true
    }
  } catch (error) {
    console.error('[DB] Error al insertar la data', error.message);
  }
}

module.exports = {
  insertDBData
}