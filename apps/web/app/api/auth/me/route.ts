import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    let authHeader = request.headers.get('authorization')

    // Fallback: read from cookie if header missing
    if (!authHeader) {
      const token = request.cookies.get('auth_token')?.value
      if (token) authHeader = `Bearer ${token}`
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      )
    }

    const internalBase = process.env.INTERNAL_API_URL || 'http://127.0.0.1:3001'
    const response = await fetch(`${internalBase}/api/v1/auth/me`, {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
      },
      cache: 'no-store',
    })

    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const data = await response.json()
      return NextResponse.json(data, { status: response.status })
    }

    const text = await response.text()
    return new NextResponse(text, { status: response.status })
  } catch (error) {
    console.error('Auth me proxy error:', error)
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}


