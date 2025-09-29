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
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) throw new Error('Login failed');
    const data = await response.json();
    return data as LoginResponse;
  } catch (error) {
    return { success: false, message: (error as Error)?.message || 'Network error' };
  }
}

export async function validateToken(token: string): Promise<boolean> {
  try {
    const response = await fetch('/api/v1/auth/validate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    return response.ok;
  } catch {
    return false;
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