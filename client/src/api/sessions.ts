import type {
  CreateSessionResponse,
  GetSessionResponse,
  ListSessionsResponse,
  UpdateSessionTitleResponse,
} from '@suagent/shared/session'
import { apiUrl, getResponseError } from './http'

export async function listSessions(signal?: AbortSignal) {
  const response = await fetch(apiUrl('/api/sessions'), { signal })
  if (!response.ok) throw new Error(await getResponseError(response))
  const data = (await response.json()) as ListSessionsResponse
  return data.sessions
}

export async function createSession() {
  const response = await fetch(apiUrl('/api/sessions'), { method: 'POST' })
  if (!response.ok) throw new Error(await getResponseError(response))
  const data = (await response.json()) as CreateSessionResponse
  return data.session
}

export async function getSession(id: string, signal?: AbortSignal) {
  const response = await fetch(
    apiUrl(`/api/sessions/${encodeURIComponent(id)}`),
    { signal },
  )
  if (!response.ok) throw new Error(await getResponseError(response))
  const data = (await response.json()) as GetSessionResponse
  return data.session
}

export async function updateSessionTitle(id: string, title: string) {
  const response = await fetch(
    apiUrl(`/api/sessions/${encodeURIComponent(id)}`),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    },
  )
  if (!response.ok) throw new Error(await getResponseError(response))
  const data = (await response.json()) as UpdateSessionTitleResponse
  return data.session
}

export async function deleteSession(id: string): Promise<void> {
  const response = await fetch(
    apiUrl(`/api/sessions/${encodeURIComponent(id)}`),
    { method: 'DELETE' },
  )
  if (!response.ok) throw new Error(await getResponseError(response))
}
