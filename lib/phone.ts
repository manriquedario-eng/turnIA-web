// Normalización de teléfonos a formato internacional (E.164: "+" seguido de
// 8 a 15 dígitos, sin espacios ni separadores).
//
// Deliberadamente NO asume un país por defecto (Argentina u otro) salvo que
// el llamador lo pida explícitamente vía `defaultCountryCallingCode`, porque
// convertir un número local sin saber el país produce falsos positivos: un
// E.164 "válido" pero incorrecto es peor que dejarlo sin normalizar.
//
// Limitación conocida para Argentina: los números de línea móvil requieren
// el prefijo "9" después del código de país para WhatsApp/telefonía
// internacional (ej. WhatsApp espera +54 9 11 xxxx-xxxx para un celular de
// Buenos Aires, no +54 11 xxxx-xxxx). Este helper NO agrega ese "9" —
// hacerlo mal es peor que no normalizar. Si en el futuro se normalizan
// números argentinos automáticamente, hay que resolver esta ambigüedad
// explícitamente (por ejemplo, preguntándole al profesional o guardando el
// tipo de línea), no adivinarla acá.

export type PhoneNormalizationResult = {
  /** El valor tal cual lo escribió la persona, sin tocar. */
  original: string;
  /** Formato internacional "+<dígitos>", o null si no se pudo determinar con confianza. */
  e164: string | null;
  /** true sólo cuando `e164` es un valor en el que confiamos razonablemente. */
  isValid: boolean;
  /** Explicación breve cuando no se pudo normalizar o cuando se asumió un país. */
  note?: string;
};

export function normalizePhone(
  rawInput: string | null | undefined,
  options?: { defaultCountryCallingCode?: string },
): PhoneNormalizationResult {
  const original = (rawInput ?? '').trim();
  if (!original) {
    return { original: '', e164: null, isValid: false };
  }

  // Limpieza: quitar espacios, guiones, puntos, paréntesis y el símbolo "00"
  // usado en muchos países como prefijo de marcado internacional.
  let cleaned = original.replace(/[\s\-.()]/g, '');
  if (cleaned.startsWith('00')) {
    cleaned = `+${cleaned.slice(2)}`;
  }

  if (cleaned.startsWith('+')) {
    const digits = cleaned.slice(1);
    if (/^\d{8,15}$/.test(digits)) {
      return { original, e164: `+${digits}`, isValid: true };
    }
    return {
      original,
      e164: null,
      isValid: false,
      note: 'Tiene formato internacional pero la cantidad de dígitos no es válida (se esperan 8 a 15).',
    };
  }

  // Sin "+": no hay forma confiable de saber el país sin que alguien lo indique.
  const digitsOnly = cleaned.replace(/\D/g, '');
  if (!digitsOnly) {
    return { original, e164: null, isValid: false, note: 'No se reconocieron dígitos.' };
  }

  if (options?.defaultCountryCallingCode && /^\d{6,13}$/.test(digitsOnly)) {
    return {
      original,
      e164: `+${options.defaultCountryCallingCode}${digitsOnly}`,
      isValid: true,
      note: `Se asumió el código de país +${options.defaultCountryCallingCode} porque el número no lo incluía. Revisar manualmente, especialmente si es un celular argentino (WhatsApp puede requerir el "9" adicional).`,
    };
  }

  return {
    original,
    e164: null,
    isValid: false,
    note: 'No incluye código de país (ej. +54) y no se configuró uno por defecto. Se guarda sólo el teléfono original.',
  };
}
