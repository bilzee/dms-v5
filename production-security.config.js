// Production Security Configuration
// This file contains security headers and configurations for production deployment

const securityHeaders = [
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on'
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload'
  },
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block'
  },
  {
    key: 'X-Frame-Options',
    value: 'SAMEORIGIN'
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff'
  },
  {
    key: 'Referrer-Policy',
    value: 'origin-when-cross-origin'
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // PWA requires some inline scripts
      "style-src 'self' 'unsafe-inline'", // Tailwind CSS requires inline styles
      "img-src 'self' data: https:", // Allow images from HTTPS and data URIs
      "font-src 'self'",
      "connect-src 'self' https://tiles.openfreemap.org", // MapLibre vector tiles/styles/fonts
      "media-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join('; ')
  }
];

const productionConfig = {
  // Security headers
  securityHeaders,
  
  // Environment checks
  isProduction: () => process.env.NODE_ENV === 'production',
  
  // Database security
  requireSSL: () => process.env.NODE_ENV === 'production',
  
  // JWT configuration
  getJWTConfig: () => ({
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    issuer: process.env.NEXTAUTH_URL || 'localhost',
    audience: process.env.NEXTAUTH_URL || 'localhost'
  }),
  
  // Rate limiting configuration
  getRateLimitConfig: () => ({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false
  }),
  
  // CORS configuration for production
  getCORSConfig: () => ({
    origin: process.env.NODE_ENV === 'production' 
      ? [process.env.NEXTAUTH_URL] 
      : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
};

module.exports = productionConfig;