import { AuthService } from '@/lib/auth/service'

/**
 * Service integration — JWT + bcrypt primitives (node env; no DB rows needed).
 * Route-level auth flows are covered in tests/api/auth-routes.test.ts; this
 * suite pins the token contract every withAuth request depends on.
 */

const payload = {
  userId: 'user-123',
  email: 'baseline@example.com',
  roles: ['COORDINATOR', 'ASSESSOR'],
  permissions: ['incident:create', 'assessment:verify'],
}

describe('services — AuthService token + password primitives', () => {
  test('generateToken → verifyToken round-trips the identity payload', () => {
    const token = AuthService.generateToken(payload)
    const decoded = AuthService.verifyToken(token)
    expect(decoded.userId).toBe(payload.userId)
    expect(decoded.email).toBe(payload.email)
    expect(decoded.roles).toEqual(payload.roles)
    expect(decoded.permissions).toEqual(payload.permissions)
  })

  test('issued tokens carry iat/exp claims from the JWT layer', () => {
    const decoded = AuthService.verifyToken(AuthService.generateToken(payload))
    expect(typeof decoded.iat).toBe('number')
    expect(typeof decoded.exp).toBe('number')
    expect(decoded.exp).toBeGreaterThan(decoded.iat)
  })

  test('tokens for different payloads differ', () => {
    expect(AuthService.generateToken(payload)).not.toBe(
      AuthService.generateToken({ ...payload, userId: 'user-456' })
    )
  })

  test('default expiry window is 24h (exp − iat = 86400s)', () => {
    const decoded = AuthService.verifyToken(AuthService.generateToken(payload))
    expect(decoded.exp - decoded.iat).toBe(86400)
  })

  test('garbage token → throws the canonical invalid-token error', () => {
    expect(() => AuthService.verifyToken('not-a-jwt')).toThrow('Invalid or expired token')
  })

  test('tampered signature → rejected', () => {
    const token = AuthService.generateToken(payload)
    const [header, body, signature] = token.split('.')
    const tampered = `${header}.${body}.${signature.slice(0, -2)}aa`
    expect(() => AuthService.verifyToken(tampered)).toThrow('Invalid or expired token')
  })

  test('hashPassword/comparePassword round-trip', async () => {
    const hash = await AuthService.hashPassword('correct horse battery staple')
    expect(hash).not.toContain('correct')
    expect(await AuthService.comparePassword('correct horse battery staple', hash)).toBe(true)
    expect(await AuthService.comparePassword('wrong password', hash)).toBe(false)
  })

  test('hashes are salted: same password → different hashes, both verifiable', async () => {
    const a = await AuthService.hashPassword('same-password')
    const b = await AuthService.hashPassword('same-password')
    expect(a).not.toBe(b)
    expect(await AuthService.comparePassword('same-password', a)).toBe(true)
    expect(await AuthService.comparePassword('same-password', b)).toBe(true)
  })
})
