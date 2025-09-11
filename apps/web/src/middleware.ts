import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(request: NextRequest) {
  // Get token from Authorization header or cookie
  const authHeader = request.headers.get('authorization')
  const tokenFromHeader = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null
  
  // Get token from cookie
  const tokenFromCookie = request.cookies.get('auth_token')?.value
  
  const token = tokenFromHeader || tokenFromCookie

  // If accessing login page, allow it
  if (request.nextUrl.pathname === '/login') {
    return NextResponse.next()
  }

  // If accessing API endpoints, let them handle their own authentication
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // For protected routes, check for token
  const protectedRoutes = ['/dashboard', '/settings']
  const isProtectedRoute = protectedRoutes.some(route => 
    request.nextUrl.pathname.startsWith(route)
  )

  if (isProtectedRoute && !token) {
    // Redirect to login if no token and accessing protected route
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|login).*)"]
}