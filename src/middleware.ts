import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ROLE_ROUTE_PREFIXES } from '@/lib/auth/route-config';

const PUBLIC_ROUTES = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
  '/api/v1/donors',
  '/api/health',
  '/_next',
  '/manifest.json',
  '/api/branding/icon',
  '/api/v1/manifest',
  '/favicon.ico',
  '/offline.html',
];

const AUTH_REQUIRED_ROUTES = [
  '/api/v1',
  '/(auth)',
];

interface AuthTokenPayload {
  userId: string;
  email: string;
  roles: string[];
  permissions: string[];
  exp: number;
}

function isPublicRoute(pathname: string): boolean {
  if (pathname === '/') return true;
  if (pathname === '/login' || pathname === '/register') return true;
  return PUBLIC_ROUTES.some(route => {
    if (route === '/api/v1/donors') {
      return pathname === route;
    }
    return pathname.startsWith(route);
  });
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

function canAccessPath(pathname: string, roles: string[]): boolean {
  if (pathname.startsWith('/(auth)/dashboard')) return true;
  if (pathname.startsWith('/(auth)/roles')) return true;

  for (const role of roles) {
    const routes = ROLE_ROUTE_PREFIXES[role];
    if (routes?.some(route => pathname.startsWith(route))) {
      return true;
    }
  }
  return false;
}

function resolveJwtSecret(): string | null {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'development') return 'build-time-placeholder-secret';
  return null;
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function verifyToken(token: string): Promise<AuthTokenPayload | null> {
  const secret = resolveJwtSecret();
  if (!secret) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  try {
    const header = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedHeader)));
    if (header.alg !== 'HS256') return null;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64Url(encodedSignature),
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    );
    if (!isValid) return null;

    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload)));
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) return null;
    if (typeof payload.userId !== 'string' || !Array.isArray(payload.roles)) return null;

    return payload as AuthTokenPayload;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  const isAuthRequired = AUTH_REQUIRED_ROUTES.some(route => pathname.startsWith(route));
  if (!isAuthRequired) {
    return NextResponse.next();
  }

  if (isApiRoute(pathname)) {
    return NextResponse.next({
      headers: { 'x-middleware-processed': 'true' },
    });
  }

  const authorization = request.headers.get('Authorization');
  const cookieToken = request.cookies.get('auth_token')?.value;

  let token: string | null = null;
  if (authorization?.startsWith('Bearer ')) {
    token = authorization.substring(7);
  } else if (cookieToken) {
    token = cookieToken;
  }

  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  const payload = await verifyToken(token);

  if (!payload) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    loginUrl.searchParams.set('error', 'session_expired');
    return NextResponse.redirect(loginUrl);
  }

  if (!payload.roles || payload.roles.length === 0) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('error', 'no_roles');
    return NextResponse.redirect(loginUrl);
  }

  if (!canAccessPath(pathname, payload.roles)) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('error', 'access_denied');
    return NextResponse.redirect(loginUrl);
  }

  const response = NextResponse.next();
  response.headers.set('x-user-id', payload.userId);
  response.headers.set('x-user-roles', payload.roles.join(','));
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
