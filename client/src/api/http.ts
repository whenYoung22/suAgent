const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''

export function apiUrl(path: string): string {
  return `${apiBaseUrl}${path}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function getResponseError(response: Response): Promise<string> {
  const body = await response.text()
  if (body) {
    try {
      const value: unknown = JSON.parse(body)
      if (isRecord(value)) {
        const record = value
        if (typeof record.message === 'string') return record.message
        if (
          isRecord(record.error) &&
          typeof record.error.message === 'string'
        ) {
          return record.error.message
        }
      }
    } catch {
      return body
    }
    return body
  }

  return `Request failed with HTTP ${response.status}.`
}
