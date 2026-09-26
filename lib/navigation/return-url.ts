export function safeAgendaReturnPath(rawValue: unknown): string {
  const returnTo = String(rawValue || '/agenda');

  if (
    returnTo === '/agenda' ||
    returnTo.startsWith('/agenda?') ||
    returnTo.startsWith('/agenda#')
  ) {
    return returnTo;
  }

  if (/^\/patients\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:[?#].*)?$/i.test(returnTo)) {
    return returnTo;
  }

  return '/agenda';
}

export function appendQueryParam(path: string, key: string, value: string): string {
  const params = new URLSearchParams({ [key]: value });
  return appendQueryParams(path, params);
}

export function appendQueryParams(
  path: string,
  params: URLSearchParams,
  hashOverride?: string,
): string {
  const hashIndex = path.indexOf('#');
  const base = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const existingHash = hashIndex >= 0 ? path.slice(hashIndex) : '';
  const separator = base.includes('?') ? '&' : '?';
  const hash = hashOverride ?? existingHash;

  return `${base}${separator}${params.toString()}${hash}`;
}
