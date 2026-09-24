# Arquitectura Digilogix en TurnIA

## Modelo

TurnIA integra Digilogix como plataforma/partner. La relación es **1 integración técnica de TurnIA → N profesionales**.

### Configuración global de TurnIA

Las variables `DIGILOGIX_*` de autenticación técnica pertenecen a TurnIA como software integrador. Se configuran una sola vez por ambiente y nunca se crean, rotan ni modifican cuando un profesional conecta su firma.

Incluyen la URL de API, credenciales técnicas, parámetros criptográficos, identificador de usuario técnico y EmpresaID asignados por Digilogix.

**Regla:** nunca guardar CUIL, email, contraseña, PIN, OTP o credenciales personales de un profesional en variables de entorno.

### Vinculación por profesional

Cada profesional conecta Digilogix desde Configuración → Integraciones.

TurnIA conserva únicamente:

- tenant/user de TurnIA;
- CUIL;
- email;
- estado de la conexión/certificado;
- timestamps de conexión y última verificación.

La tabla `digilogix_connections` es la fuente de verdad de esta vinculación por usuario.

TurnIA puede usar CUIL/email para consultar si existe un certificado y, si hace falta, iniciar el onboarding de Digilogix.

### Datos que TurnIA no administra

TurnIA no solicita ni almacena:

- contraseña personal de Digilogix;
- PIN de firma;
- OTP/TOTP;
- semilla del autenticador;
- clave privada del certificado del profesional.

Esos datos se ingresan y procesan exclusivamente en el entorno de Digilogix.

### Firma de documentos

1. TurnIA autentica al profesional en su propia sesión.
2. TurnIA valida que ese usuario tenga una conexión Digilogix activa.
3. El backend usa la credencial técnica global de TurnIA para crear la solicitud de firma e identifica al firmante por CUIL.
4. Digilogix devuelve una URL de autorización.
5. El profesional autoriza la firma en Digilogix con sus mecanismos personales.
6. Digilogix devuelve el flujo a TurnIA.
7. TurnIA consulta el estado, recibe el PDF firmado y guarda trazabilidad.

### Operación SaaS

Agregar 1, 10 o 10.000 profesionales no requiere crear variables de entorno nuevas ni hacer redeploys. El alta/baja de profesionales modifica únicamente su vinculación en base de datos.

La única tarea operativa de TurnIA respecto de credenciales es mantener vigente la credencial técnica global que Digilogix asigne al software/plataforma.

### Ambientes

- Preview/staging puede usar el endpoint de homologación.
- Producción nunca habilita la integración mientras la URL configurada sea la de TEST.
- Las credenciales de homologación y producción son configuración de plataforma, no de profesionales.
