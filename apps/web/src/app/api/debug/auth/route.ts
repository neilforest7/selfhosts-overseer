import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const tokenFromHeader = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null
  
  // Get token from cookie
  const tokenFromCookie = request.cookies.get('auth_token')?.value
  
  return NextResponse.json({
    authHeader: authHeader,
    tokenFromHeader: tokenFromHeader,
    tokenFromCookie: tokenFromCookie,
    allCookies: request.cookies.getAll(),
  })
}