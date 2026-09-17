import { getAuthToken, getAuthHeaders } from '@/lib/auth/token-utils'

export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  /** Error details echoed by the API envelope (e.g. registry_invalid `errors`,
   *  question_frozen `affectedCount`). Present only on failed calls. */
  details?: unknown
  meta?: {
    timestamp: string
    version: string
    requestId: string
  }
}

export { getAuthToken, getAuthHeaders }

export function extractArray<T = any>(data: any): T[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    if (Array.isArray(data.items)) return data.items
    if (Array.isArray(data.data)) return data.data
  }
  return []
}

/**
 * Make an authenticated GET request
 */
export const apiGet = async <T = any>(url: string, options?: RequestInit): Promise<ApiResponse<T>> => {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...getAuthHeaders(),
        ...options?.headers
      },
      ...options
    })

    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.error || `HTTP ${response.status}: ${response.statusText}`,
        details: data.details
      }
    }

    return data
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error'
    }
  }
}

/**
 * Make an authenticated POST request
 */
export const apiPost = async <T = any>(
  url: string, 
  body?: any, 
  options?: RequestInit
): Promise<ApiResponse<T>> => {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
        ...options?.headers
      },
      body: body ? JSON.stringify(body) : undefined,
      ...options
    })

    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.error || `HTTP ${response.status}: ${response.statusText}`,
        details: data.details
      }
    }

    return data
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error'
    }
  }
}

/**
 * Make an authenticated PUT request
 */
export const apiPut = async <T = any>(
  url: string, 
  body?: any, 
  options?: RequestInit
): Promise<ApiResponse<T>> => {
  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        ...getAuthHeaders(),
        ...options?.headers
      },
      body: body ? JSON.stringify(body) : undefined,
      ...options
    })

    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.error || `HTTP ${response.status}: ${response.statusText}`,
        details: data.details
      }
    }

    return data
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error'
    }
  }
}

/**
 * Make an authenticated PATCH request
 */
export const apiPatch = async <T = any>(
  url: string,
  body?: any,
  options?: RequestInit
): Promise<ApiResponse<T>> => {
  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        ...getAuthHeaders(),
        ...options?.headers
      },
      body: body ? JSON.stringify(body) : undefined,
      ...options
    })

    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.error || `HTTP ${response.status}: ${response.statusText}`,
        details: data.details
      }
    }

    return data
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error'
    }
  }
}

/**
 * Make an authenticated DELETE request
 */
export const apiDelete = async <T = any>(url: string, options?: RequestInit): Promise<ApiResponse<T>> => {
  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        ...getAuthHeaders(),
        ...options?.headers
      },
      ...options
    })

    const data = await response.json().catch(() => null)

    if (!response.ok) {
      return {
        success: false,
        error: (data && data.error) || `HTTP ${response.status}: ${response.statusText}`,
        details: data ? data.details : undefined
      }
    }

    // 204 No Content (e.g. question deactivation) has no JSON envelope.
    if (!data) return { success: true }

    return data
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error'
    }
  }
}