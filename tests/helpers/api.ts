import { NextRequest } from 'next/server'
import { AuthService } from '@/lib/auth/service'
import type { User } from '@prisma/client'
import { testDb } from './test-db'

/**
 * Helpers for invoking Next.js route handlers directly in the API suite.
 *
 * withAuth (src/lib/auth/middleware.ts) reads `Authorization: Bearer <jwt>`
 * and re-loads the user + roles + permissions from the DB on every call, so a
 * token minted from a factory user exercises the real auth path.
 */

const BASE = 'http://localhost:3000'

export interface AuthedUser extends User {
  roles: Array<{
    role: {
      name: string
      permissions: Array<{ permission: { code: string } }>
    }
  }>
}

export function rolesOf(user: AuthedUser): string[] {
  return user.roles.map((ur) => ur.role.name)
}

export function permissionsOf(user: AuthedUser): string[] {
  return Array.from(
    new Set(user.roles.flatMap((ur) => ur.role.permissions.map((p) => p.permission.code)))
  )
}

/** Mint a real JWT for a factory user (withAuth re-validates against the DB). */
export function tokenFor(user: AuthedUser): string {
  return AuthService.generateToken({
    userId: user.id,
    email: user.email,
    roles: rolesOf(user),
    permissions: permissionsOf(user),
  })
}

export interface MakeRequestOptions {
  body?: unknown
  token?: string
  query?: Record<string, string | number | undefined>
}

/** Build a NextRequest the same way Next.js would for an incoming API call. */
export function makeRequest(method: string, path: string, options: MakeRequestOptions = {}): NextRequest {
  const url = new URL(path, BASE)
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
  }
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`

  return new NextRequest(url.toString(), {
    method,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    headers,
  })
}

/**
 * Invoke a dynamic-route handler with params.
 * Next.js 14 passes { params: { id } } as the second argument.
 */
export function withParams(params: Record<string, string>): { params: Record<string, string> } {
  return { params }
}

/** Parse a NextResponse's JSON body. */
export async function jsonOf(response: Response): Promise<any> {
  return response.json()
}

/** Refresh a user from the DB (e.g. after role/permission grants). */
export async function reloadUser(userId: string): Promise<AuthedUser> {
  const user = await testDb.user.findUnique({
    where: { id: userId },
    include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    },
  })
  if (!user) throw new Error(`User ${userId} not found`)
  return user as AuthedUser
}
