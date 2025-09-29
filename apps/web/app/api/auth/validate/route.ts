import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { valid: false },
        { status: 401 }
      )
    }

    const token = authHeader.substring(7)
    
    // Forward the validation request to the backend server (same container, internal URL)
    const internalBase = process.env.INTERNAL_API_URL || 'http://127.0.0.1:3001';
    const response = await fetch(`${internalBase}/api/v1/auth/validate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    })

    if (response.ok) {
      return NextResponse.json({ valid: true })
    } else {
      return NextResponse.json({ valid: false }, { status: 401 })
    }
  } catch (error) {
    console.error('Token validation error:', error)
    return NextResponse.json(
      { valid: false },
      { status: 500 }
    )
  }
}