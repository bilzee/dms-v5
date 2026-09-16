import { Entity } from '@/lib/services/entity-assignment.service'

/**
 * Get current user name from auth context
 * Returns formatted user name for assessment forms
 */
export const getCurrentUserName = (): string => {
  // Try to get user from auth store first
  if (typeof window !== 'undefined') {
    try {
      // Dynamic import to avoid SSR issues
      const { useAuthStore } = require('@/stores/auth.store')
      const authStore = useAuthStore.getState()
      
      if (authStore.user?.name) {
        return authStore.user.name
      }
      
      if (authStore.user?.username) {
        return authStore.user.username
      }
      
      if (authStore.user?.email) {
        // Extract name from email (e.g., "john.doe@example.com" -> "john.doe")
        return authStore.user.email.split('@')[0]
      }
    } catch (error) {
      console.warn('Auth store not available, using fallback:', error)
    }
  }
  
  // Fallback for development/testing
  return 'Current User'
}

/**
 * Get location string from entity or GPS coordinates
 * Prioritizes entity location, falls back to GPS coordinates
 */
export const getLocationFromEntityOrGPS = (
  entity: Entity | null,
  gpsCoordinates?: { latitude: number; longitude: number }
): string => {
  // First try entity location
  if (entity?.location) {
    return entity.location
  }
  
  // Fall back to GPS coordinates
  if (gpsCoordinates) {
    return `${gpsCoordinates.latitude.toFixed(6)}, ${gpsCoordinates.longitude.toFixed(6)}`
  }
  
  // Final fallback
  return ''
}

/**
 * Format GPS coordinates for display
 */
export const formatGPSCoordinates = (coordinates: {
  latitude: number
  longitude: number
  accuracy?: number
}): string => {
  const { latitude, longitude, accuracy } = coordinates
  
  let formatted = `${latitude.toFixed(6)}°${latitude >= 0 ? 'N' : 'S'}, ${longitude.toFixed(6)}°${longitude >= 0 ? 'E' : 'W'}`
  
  if (accuracy) {
    formatted += ` (±${accuracy}m)`
  }
  
  return formatted
}

/**
 * Check if GPS coordinates are valid
 */
export const isValidGPSCoordinates = (coordinates?: {
  latitude: number
  longitude: number
}): boolean => {
  if (!coordinates) return false
  
  const { latitude, longitude } = coordinates
  
  return (
    latitude >= -90 && latitude <= 90 &&
    longitude >= -180 && longitude <= 180 &&
    !isNaN(latitude) && !isNaN(longitude)
  )
}

/**
 * Calculate distance between two GPS coordinates (Haversine formula)
 */
export const calculateGPSDistance = (
  coord1: { latitude: number; longitude: number },
  coord2: { latitude: number; longitude: number }
): number => {
  const R = 6371 // Earth's radius in kilometers
  const dLat = (coord2.latitude - coord1.latitude) * Math.PI / 180
  const dLon = (coord2.longitude - coord1.longitude) * Math.PI / 180
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(coord1.latitude * Math.PI / 180) * Math.cos(coord2.latitude * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}