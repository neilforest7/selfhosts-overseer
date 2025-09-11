// Backend API authentication utilities
export interface LoginResponse {
  success: boolean
  message: string
  user?: {
    id: string
    username: string
  }
  token?: string
}

export interface User {
  id: string
  username: string
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    })

    if (!response.ok) {
      throw new Error('Login failed')
    }

    return await response.json()
  } catch (error) {
    console.error('Login error:', error)
    return {
      success: false,
      message: 'Network error occurred',
    }
  }
}

export async function validateToken(token: string): Promise<boolean> {
  try {
    const response = await fetch('/api/auth/validate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    })

    return response.ok
  } catch (error) {
    console.error('Token validation error:', error)
    return false
  }
}

export function getToken(): string | null {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('auth_token')
  }
  return null
}

export function setToken(token: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('auth_token', token)
  }
}

export function removeToken(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('auth_token')
  }
}

export function getUser(): User | null {
  if (typeof window !== 'undefined') {
    const userStr = localStorage.getItem('auth_user')
    return userStr ? JSON.parse(userStr) : null
  }
  return null
}

export function setUser(user: User): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('auth_user', JSON.stringify(user))
  }
}

export function removeUser(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('auth_user')
  }
}

export function isAuthenticated(): boolean {
  return getToken() !== null
}

export function logout(): void {
  removeToken()
  removeUser()
}