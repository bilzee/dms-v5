import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { render, screen } from '@testing-library/react'
import React from 'react'

// Mock a simple donor component
const DonorSummary = ({ name, type }: { name: string; type: string }) => 
  React.createElement('div', { 'data-testid': 'donor-summary' },
    React.createElement('h1', null, name),
    React.createElement('p', null, type)
  )

describe('Donor Simple Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should render donor information correctly', () => {
    const donorData = {
      name: 'Test Donor Org',
      type: 'ORGANIZATION'
    }

    render(React.createElement(DonorSummary, donorData))

    expect(screen.getByTestId('donor-summary')).toBeInTheDocument()
    expect(screen.getByText('Test Donor Org')).toBeInTheDocument()
    expect(screen.getByText('ORGANIZATION')).toBeInTheDocument()
  })

  it('should handle different donor types', () => {
    const donorData = {
      name: 'Individual Donor',
      type: 'INDIVIDUAL'
    }

    render(React.createElement(DonorSummary, donorData))

    expect(screen.getByTestId('donor-summary')).toBeInTheDocument()
    expect(screen.getByText('Individual Donor')).toBeInTheDocument()
    expect(screen.getByText('INDIVIDUAL')).toBeInTheDocument()
  })
})