// API client with automatic authentication
import { getToken } from './auth-backend'

export interface ApiResponse<T = any> {
  success?: boolean
  data?: T
  message?: string
  error?: string
}

class ApiClient {
  private baseURL: string

  constructor(baseURL: string = '') {
    this.baseURL = baseURL
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const token = getToken()
    
    const config: RequestInit = {
      ...options,
      headers: {
        ...(options.body && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
      },
    }

    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, config)
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          error: errorData.message || `HTTP ${response.status}`,
        }
      }

      // Handle empty responses (like 204 No Content)
      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        return { success: true, data: null }
      }

      const data = await response.json()
      return { success: true, data }
    } catch (error) {
      console.error('API request failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async get<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'GET' })
  }

  async post<T>(endpoint: string, data?: any): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    })
  }

  async put<T>(endpoint: string, data?: any): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    })
  }

  async patch<T>(endpoint: string, data?: any): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    })
  }

  async delete<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'DELETE' })
  }

  async upload<T>(endpoint: string, file: File): Promise<ApiResponse<T>> {
    const token = getToken()
    
    const formData = new FormData()
    formData.append('file', file)

    const config: RequestInit = {
      method: 'POST',
      body: formData,
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
      },
    }

    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, config)
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          error: errorData.message || `HTTP ${response.status}`,
        }
      }

      const data = await response.json()
      return { success: true, data }
    } catch (error) {
      console.error('File upload failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
}

// Create API client instance
export const apiClient = new ApiClient('http://localhost:3001')

// Convenience methods for common API endpoints
export const api = {
  hosts: {
    list: () => apiClient.get('/api/v1/hosts'),
    create: (data: any) => apiClient.post('/api/v1/hosts', data),
    update: (id: string, data: any) => apiClient.patch(`/api/v1/hosts/${id}`, data),
    delete: (id: string) => apiClient.delete(`/api/v1/hosts/${id}`),
    testConnection: (id: string) => apiClient.post(`/api/v1/hosts/${id}/test-connection`),
    getConnectivity: (id: string) => apiClient.get(`/api/v1/hosts/${id}/connectivity`),
    checkConnectivity: (id: string) => apiClient.post(`/api/v1/hosts/${id}/check-connectivity`),
  },
  containers: {
    list: () => apiClient.get('/api/v1/containers'),
    discover: (hostId: string) => apiClient.post('/api/v1/containers/discover', { hostId }),
    update: (id: string) => apiClient.post(`/api/v1/containers/${id}/update`),
    restart: (id: string) => apiClient.post(`/api/v1/containers/${id}/restart`),
    start: (id: string) => apiClient.post(`/api/v1/containers/${id}/start`),
    stop: (id: string) => apiClient.post(`/api/v1/containers/${id}/stop`),
  },
  tasks: {
    exec: (data: any) => apiClient.post('/api/v1/tasks/exec', data),
  },
  plugins: {
    list: () => apiClient.get('/api/v1/plugins'),
    get: (id: string) => apiClient.get(`/api/v1/plugins/${id}`),
    enable: (id: string) => apiClient.post(`/api/v1/plugins/${id}/enabled`),
    reload: (id: string) => apiClient.post(`/api/v1/plugins/${id}/reload`),
  },
  auth: {
    validate: () => apiClient.post('/api/auth/validate'),
    me: () => apiClient.get('/auth/me'),
    uploadAvatar: (file: File) => apiClient.upload('/auth/avatar', file),
  }
}

export default apiClient