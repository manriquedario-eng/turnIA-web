// Normalización de teléfonos a formato internacional (E.164: "+" seguido de
// 8 a 15 dígitos, sin espacios ni separadores).
//
// Históricamente este helper NO asumía país salvo que el llamador lo pidiera
// explícitamente (`defaultCountryCallingCode`), porque convertir un número
// local sin saber el país produce falsos positivos. Eso se mantiene: sigue
// sin "inventar" un país para un número ambiguo como "261...".
//
// Lo que cambia (corrección técnica sobre la v2 de la UI): `PhoneInput`
// ahora le pide explícitamente a la persona qué prefijo/país está usando
// (por defecto Argentina celular, +54 9). Cuando ese prefijo llega acá
// como `selectedPrefix`, YA NO es una suposición del servidor — es un dato
// que la persona eligió en la UI — así que se usa para normalizar de forma
// robusta, incluyendo el caso argentino específico: código de país 54 +
// prefijo de celular 9, sin duplicar ninguno de los dos aunque la persona
// ya los haya tipeado (549261..., +54 9 261..., 0261..., etc.).

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

// Prefijos que ofrece el selector de `PhoneInput` — server y client deben
// coincidir en estos valores exactos (son los que llegan en el campo
// oculto `phone_country_prefix`).
export type KnownCountryPrefix = '+54 9' | '+54' | '+598' | '+595' | '+56' | '+34' | '+1';

const GENERIC_COUNTRY_CODES: Partial<Record<KnownCountryPrefix, string>> = {
  '+598': '598',
  '+595': '595',
  '+56': '56',
  '+34': '34',
  '+1': '1',
};

function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

// Quita un único "0" de larga distancia al principio (ej. "0261..." →
// "261..."). Nunca quita más de uno: un número que empiece con "00" ya se
// resolvió antes como prefijo de marcado internacional, no como esto.
function stripSingleLeadingZero(digits: string): string {
  return digits.startsWith('0') ? digits.slice(1) : digits;
}

// Arma un E.164 argentino (+54...) a partir de dígitos "crudos" que pueden
// venir en cualquiera de estas formas: con o sin "54" adelante, con o sin
// "9" de celular, con o sin "0" de larga distancia. Nunca duplica el 54 ni
// el 9 — si ya vienen, se respetan tal cual.
function buildArgentina(rawDigits: string, forceMobile: boolean): string | null {
  let digits = rawDigits;

  if (digits.startsWith('54')) {
    digits = digits.slice(2);
  }

  let hasNine = false;
  if (digits.startsWith('9')) {
    hasNine = true;
    digits = digits.slice(1);
  }

  digits = stripSingleLeadingZero(digits);

  if (forceMobile || hasNine) {
    digits = `9${digits}`;
  }

  const e164Digits = `54${digits}`;
  // Un número argentino completo (código de país + 9 opcional + código de
  // área + número) cae razonablemente entre 12 y 13 dígitos; se deja un
  // margen (10–13) para no rechazar de más casos válidos pero sí detectar
  // entradas claramente incompletas o basura.
  if (!/^\d{10,13}$/.test(e164Digits)) return null;
  return `+${e164Digits}`;
}

// Arma un E.164 genérico (no argentino) a partir de un código de país fijo
// ya conocido (Uruguay, Paraguay, Chile, España, EE.UU./Canadá...). No
// aplica ninguna lógica de "9" — eso es específico de Argentina.
function buildGeneric(rawDigits: string, countryCode: string): string | null {
  let digits = rawDigits;
  if (digits.startsWith(countryCode)) {
    digits = digits.slice(countryCode.length);
  }
  digits = stripSingleLeadingZero(digits);
  const e164Digits = `${countryCode}${digits}`;
  if (!/^\d{8,15}$/.test(e164Digits)) return null;
  return `+${e164Digits}`;
}

export function normalizePhone(
  rawInput: string | null | undefined,
  options?: {
    /** Compatibilidad hacia atrás: código de país a asumir si no hay uno. */
    defaultCountryCallingCode?: string;
    /**
     * Prefijo elegido explícitamente por la persona en `PhoneInput`. Esto
     * NO es una suposición del servidor — es información que la UI ya le
     * pidió al usuario — así que habilita normalización robusta (incluida
     * la lógica de "9" argentina) sin violar "nunca inventar el país".
     */
    selectedPrefix?: KnownCountryPrefix;
  },
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

  // 1) Prefijo elegido explícitamente en la UI: es la fuente más confiable,
  // se usa primero. El campo "número" no debería traer un "+" propio, pero
  // por si la persona lo escribió igual, se lo ignora acá (no se concatena
  // dos veces con el prefijo del selector).
  if (options?.selectedPrefix) {
    const withoutLeadingPlus = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
    const digits = onlyDigits(withoutLeadingPlus);
    if (!digits) {
      return { original, e164: null, isValid: false, note: 'No se reconocieron dígitos.' };
    }

    if (options.selectedPrefix === '+54 9' || options.selectedPrefix === '+54') {
      const e164 = buildArgentina(digits, options.selectedPrefix === '+54 9');
      if (e164) return { original, e164, isValid: true };
      return {
        original,
        e164: null,
        isValid: false,
        note: 'El número no tiene una cantidad de dígitos válida para Argentina.',
      };
    }

    const countryCode = GENERIC_COUNTRY_CODES[options.selectedPrefix];
    if (countryCode) {
      const e164 = buildGeneric(digits, countryCode);
      if (e164) return { original, e164, isValid: true };
      return {
        original,
        e164: null,
        isValid: false,
        note: 'El número no tiene una cantidad de dígitos válida para el país seleccionado.',
      };
    }
  }

  // 2) Sin prefijo elegido (llamador legacy, o carga manual de un valor que
  // ya viene en otro formato): mismo comportamiento de siempre, con una
  // excepción acotada — si el número YA incluye el código de país
  // argentino (54...) de forma reconocible, se normaliza el formato sin
  // que eso cuente como "inventar" el país (el dato ya estaba ahí).
  if (cleaned.startsWith('+')) {
    const digits = cleaned.slice(1);
    if (digits.startsWith('54')) {
      const e164 = buildArgentina(digits, false);
      if (e164) return { original, e164, isValid: true };
    }
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

  const digitsOnly = cleaned.replace(/\D/g, '');
  if (!digitsOnly) {
    return { original, e164: null, isValid: false, note: 'No se reconocieron dígitos.' };
  }

  if (digitsOnly.startsWith('54') && digitsOnly.length >= 12) {
    const e164 = buildArgentina(digitsOnly, false);
    if (e164) return { original, e164, isValid: true };
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
