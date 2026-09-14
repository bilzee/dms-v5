import {
  getDefaultConfig,
  validateScoringConfig,
  type ScoringConfig,
} from '@/lib/services/scoring-config.service'

/**
 * Unit — scoring-config validation rules (pure function, no DB).
 */

describe('unit — validateScoringConfig', () => {
  test('default config is valid (weights sum to 100, all ranges in bounds)', () => {
    expect(validateScoringConfig(getDefaultConfig())).toEqual([])
  })

  test('weights not summing to 100 report the actual total', () => {
    const config: ScoringConfig = { ...getDefaultConfig(), deliveryWeight: 50 }
    const errors = validateScoringConfig(config)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/90%/)
  })

  test.each([
    ['deliveryWeight', -1, 'delivery weight'],
    ['deliveryWeight', 101, 'delivery weight'],
    ['speedWeight', -1, 'speed weight'],
    ['speedWeight', 101, 'speed weight'],
    ['valueWeight', -1, 'value weight'],
    ['consistencyWeight', 101, 'consistency weight'],
  ])('out-of-range %s=%i is rejected', (key, value, label) => {
    const config: ScoringConfig = { ...getDefaultConfig(), [key]: value } as ScoringConfig
    const errors = validateScoringConfig(config)
    expect(errors.some((e) => e.toLowerCase().includes(label))).toBe(true)
  })

  test.each([
    ['speedZeroScoreHours', 0, 'zero-score hours'],
    ['speedZeroScoreHours', 721, 'zero-score hours'],
    ['speedPenaltyRate', 0, 'penalty rate'],
    ['speedPenaltyRate', 101, 'penalty rate'],
    ['valueCap', 0, 'value cap'],
    ['valueCap', 100_000_001, 'value cap'],
    ['consistencyMaxActivitiesPerDay', 0.0001, 'activities/day'],
    ['consistencyMaxActivitiesPerDay', 101, 'activities/day'],
  ])('out-of-range %s=%p is rejected', (key, value, label) => {
    const config: ScoringConfig = { ...getDefaultConfig(), [key]: value } as ScoringConfig
    const errors = validateScoringConfig(config)
    expect(errors.some((e) => e.toLowerCase().includes(label))).toBe(true)
  })

  test('boundary values are accepted', () => {
    const config: ScoringConfig = {
      ...getDefaultConfig(),
      deliveryWeight: 0,
      speedWeight: 0,
      valueWeight: 0,
      consistencyWeight: 100,
      speedZeroScoreHours: 1,
      speedPenaltyRate: 100,
      valueCap: 100_000_000,
      consistencyMaxActivitiesPerDay: 0.001,
    }
    expect(validateScoringConfig(config)).toEqual([])
  })

  test('getDefaultConfig returns a defensive copy', () => {
    const a = getDefaultConfig()
    a.deliveryWeight = 999
    expect(getDefaultConfig().deliveryWeight).toBe(60)
  })
})
