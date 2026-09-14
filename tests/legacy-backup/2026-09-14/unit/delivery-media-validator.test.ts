import { describe, it, expect, jest } from '@jest/globals'
import { DeliveryMediaValidator } from '@/lib/utils/delivery-media-validator'

// Mock crypto.subtle.digest
Object.defineProperty(global, 'crypto', {
  value: {
    subtle: {
      digest: jest.fn().mockResolvedValue(new ArrayBuffer(32))
    }
  }
})

describe('DeliveryMediaValidator', () => {
  describe('validateDeliveryMedia', () => {
    const createMockFile = (name: string, size: number, type: string): File => {
      const buffer = new ArrayBuffer(size)
      return new File([buffer], name, { type })
    }

    const mockGPSMetadata = {
      latitude: 40.7128,
      longitude: -74.0060,
      accuracy: 10,
      timestamp: new Date()
    }

    it('should validate a correct image file with GPS', async () => {
      const file = createMockFile('test.jpg', 1024 * 1024, 'image/jpeg') // 1MB
      const deliveryTimestamp = new Date()

      const result = await DeliveryMediaValidator.validateDeliveryMedia(
        file,
        mockGPSMetadata,
        deliveryTimestamp
      )

      expect(result.isValid).toBe(true)
      expect(result.qualityScore).toBeGreaterThan(0.7)
      expect(result.gpsAccuracy).toBe(10)
      expect(result.fileSize).toBe(1024 * 1024)
    })

    it('should reject oversized files', async () => {
      const file = createMockFile('huge.jpg', 15 * 1024 * 1024, 'image/jpeg') // 15MB

      const result = await DeliveryMediaValidator.validateDeliveryMedia(file)

      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('File size too large (15.0 MB). Maximum: 10.0 MB')
    })

    it('should reject unsupported file types', async () => {
      const file = createMockFile('test.txt', 1024, 'text/plain')

      const result = await DeliveryMediaValidator.validateDeliveryMedia(file)

      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Unsupported file type: text/plain')
    })

    it('should warn about missing GPS data', async () => {
      const file = createMockFile('test.jpg', 1024 * 1024, 'image/jpeg')

      const result = await DeliveryMediaValidator.validateDeliveryMedia(file)

      expect(result.warnings).toContain('No GPS location data available')
    })

    it('should warn about poor GPS accuracy', async () => {
      const file = createMockFile('test.jpg', 1024 * 1024, 'image/jpeg')
      const poorGPS = {
        latitude: 40.7128,
        longitude: -74.0060,
        accuracy: 200, // Poor accuracy
        timestamp: new Date()
      }

      const result = await DeliveryMediaValidator.validateDeliveryMedia(file, poorGPS)

      expect(result.warnings).toContain('GPS accuracy is poor (200m)')
    })

    it('should warn about large time gaps', async () => {
      const file = createMockFile('test.jpg', 1024 * 1024, 'image/jpeg')
      const oldDeliveryTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 hours ago
      const recentGPS = {
        latitude: 40.7128,
        longitude: -74.0060,
        accuracy: 10,
        timestamp: new Date()
      }

      const result = await DeliveryMediaValidator.validateDeliveryMedia(
        file,
        recentGPS,
        oldDeliveryTimestamp
      )

      expect(result.warnings).toContain(expect.stringContaining('significant time gap'))
    })

    it('should calculate quality score correctly for high quality images', async () => {
      const file = createMockFile('high-quality.jpg', 2 * 1024 * 1024, 'image/jpeg') // 2MB

      const result = await DeliveryMediaValidator.validateDeliveryMedia(
        file,
        mockGPSMetadata
      )

      expect(result.qualityScore).toBeGreaterThan(0.8)
      expect(result.qualityFactors.fileSize).toBe(true)
      expect(result.qualityFactors.fileType).toBe(true)
    })

    it('should calculate lower quality score for low quality images', async () => {
      const file = createMockFile('low-quality.jpg', 50 * 1024, 'image/jpeg') // 50KB

      const result = await DeliveryMediaValidator.validateDeliveryMedia(
        file,
        mockGPSMetadata
      )

      expect(result.qualityScore).toBeLessThan(0.7)
      expect(result.qualityFactors.fileSize).toBe(false)
    })
  })

  describe('validateBatchMedia', () => {
    const createMockFile = (name: string, size: number, type: string): File => {
      const buffer = new ArrayBuffer(size)
      return new File([buffer], name, { type })
    }

    const mockGPSMetadata = {
      latitude: 40.7128,
      longitude: -74.0060,
      accuracy: 10,
      timestamp: new Date()
    }

    it('should validate a batch of correct media files', async () => {
      const files = [
        createMockFile('photo1.jpg', 1024 * 1024, 'image/jpeg'),
        createMockFile('photo2.jpg', 2 * 1024 * 1024, 'image/jpeg'),
        createMockFile('photo3.jpg', 1.5 * 1024 * 1024, 'image/webp')
      ]

      const result = await DeliveryMediaValidator.validateBatchMedia(
        files,
        mockGPSMetadata
      )

      expect(result.isValid).toBe(true)
      expect(result.validFiles).toHaveLength(3)
      expect(result.invalidFiles).toHaveLength(0)
      expect(result.completenessScore).toBe(1.0)
    })

    it('should handle mixed valid and invalid files', async () => {
      const files = [
        createMockFile('valid.jpg', 1024 * 1024, 'image/jpeg'),
        createMockFile('invalid.txt', 1024, 'text/plain'),
        createMockFile('too-large.jpg', 15 * 1024 * 1024, 'image/jpeg')
      ]

      const result = await DeliveryMediaValidator.validateBatchMedia(
        files,
        mockGPSMetadata
      )

      expect(result.isValid).toBe(false)
      expect(result.validFiles).toHaveLength(1)
      expect(result.invalidFiles).toHaveLength(2)
      expect(result.completenessScore).toBeLessThan(1.0)
    })

    it('should assess batch completeness correctly', async () => {
      const files = [
        createMockFile('photo1.jpg', 1024 * 1024, 'image/jpeg'),
        createMockFile('photo2.jpg', 1024 * 1024, 'image/jpeg')
      ]

      const result = await DeliveryMediaValidator.validateBatchMedia(
        files,
        mockGPSMetadata
      )

      expect(result.completenessScore).toBeGreaterThan(0.8)
      expect(result.batchSummary.recommendedAction).toBe('APPROVE')
    })

    it('should detect duplicate files', async () => {
      const file = createMockFile('duplicate.jpg', 1024 * 1024, 'image/jpeg')
      const files = [file, file] // Same file object

      const result = await DeliveryMediaValidator.validateBatchMedia(
        files,
        mockGPSMetadata
      )

      expect(result.duplicates.length).toBeGreaterThan(0)
      expect(result.warnings).toContain(expect.stringContaining('duplicate files'))
    })
  })

  describe('generateChecksum', () => {
    it('should generate consistent checksums for identical files', async () => {
      const content = new ArrayBuffer(1024)
      const file1 = new File([content], 'test1.jpg', { type: 'image/jpeg' })
      const file2 = new File([content], 'test2.jpg', { type: 'image/jpeg' })

      const checksum1 = await DeliveryMediaValidator.generateChecksum(file1)
      const checksum2 = await DeliveryMediaValidator.generateChecksum(file2)

      expect(checksum1).toBe(checksum2)
      expect(checksum1).toMatch(/^[a-f0-9]{64}$/i) // SHA-256 hex
    })

    it('should generate different checksums for different files', async () => {
      const content1 = new ArrayBuffer(1024)
      const content2 = new ArrayBuffer(2048)
      const file1 = new File([content1], 'test1.jpg', { type: 'image/jpeg' })
      const file2 = new File([content2], 'test2.jpg', { type: 'image/jpeg' })

      const checksum1 = await DeliveryMediaValidator.generateChecksum(file1)
      const checksum2 = await DeliveryMediaValidator.generateChecksum(file2)

      expect(checksum1).not.toBe(checksum2)
    })
  })

  describe('assessMediaCompleteness', () => {
    it('should score high quality media batch highly', () => {
      const score = DeliveryMediaValidator.assessMediaCompleteness(
        5, // 5 photos
        true, // all have GPS
        true, // multiple angles
        true, // before/after
        95, // 95% quality average
        0, // 0 duplicates
        3 * 60 * 1000 // 3 minutes time span
      )

      expect(score.score).toBeGreaterThan(0.9)
      expect(score.recommendedAction).toBe('APPROVE')
    })

    it('should score low quality media batch poorly', () => {
      const score = DeliveryMediaValidator.assessMediaCompleteness(
        1, // only 1 photo
        false, // no GPS
        false, // single angle
        false, // no before/after
        30, // 30% quality average
        2, // 2 duplicates
        30 * 1000 // 30 seconds time span
      )

      expect(score.score).toBeLessThan(0.5)
      expect(score.recommendedAction).toBe('REJECT')
    })

    it('should recommend additional photos for minimal batches', () => {
      const score = DeliveryMediaValidator.assessMediaCompleteness(
        2, // only 2 photos
        true, // has GPS
        false, // single angle
        false, // no before/after
        70, // decent quality
        0, // no duplicates
        2 * 60 * 1000 // 2 minutes
      )

      expect(score.recommendedAction).toBe('REQUEST_MORE')
      expect(score.recommendations).toContain(expect.stringContaining('more photos'))
    })
  })

  describe('error handling', () => {
    it('should handle corrupted files gracefully', async () => {
      // Create a file that will cause an error during processing
      const file = {
        name: 'corrupted.jpg',
        size: 1024,
        type: 'image/jpeg',
        arrayBuffer: jest.fn().mockRejectedValue(new Error('File read error'))
      } as any

      const result = await DeliveryMediaValidator.validateDeliveryMedia(file)

      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Failed to process file: File read error')
    })

    it('should handle missing GPS metadata gracefully', async () => {
      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' })
      const invalidGPS = {
        latitude: null,
        longitude: undefined,
        accuracy: -1,
        timestamp: new Date()
      } as any

      const result = await DeliveryMediaValidator.validateDeliveryMedia(
        file,
        invalidGPS
      )

      expect(result.warnings).toContain('No GPS location data available')
    })
  })
})