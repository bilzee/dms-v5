'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { RoleBasedRoute } from '@/components/shared/RoleBasedRoute'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowLeft, CheckCircle } from '@/lib/icons'
import Link from 'next/link'
import { AssessmentType } from '@/types/rapid-assessment'
import { useAuth } from '@/hooks/useAuth'
import { apiPost } from '@/lib/api'

// Registry-driven assessment form (P4) — one component for every type
import { DynamicAssessmentForm, type AssessmentFormSubmitPayload } from '@/components/forms/assessment/DynamicAssessmentForm'

const assessmentTypes = [
  { value: 'HEALTH', label: 'Health Assessment', description: 'Assess healthcare facilities and services' },
  { value: 'POPULATION', label: 'Population Assessment', description: 'Assess population demographics and needs' },
  { value: 'FOOD', label: 'Food Security Assessment', description: 'Assess food availability and access' },
  { value: 'WASH', label: 'WASH Assessment', description: 'Assess water, sanitation, and hygiene' },
  { value: 'SHELTER', label: 'Shelter Assessment', description: 'Assess shelter and living conditions' },
  { value: 'SECURITY', label: 'Security Assessment', description: 'Assess security and protection' }
]

function NewRapidAssessmentContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { token, user } = useAuth()
  const [selectedType, setSelectedType] = useState<AssessmentType | ''>(searchParams.get('type') as AssessmentType || '')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [assessmentId, setAssessmentId] = useState<string | null>(null)
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null)

  const handleTypeSelect = (type: AssessmentType) => {
    setSelectedType(type)
    router.push(`/rapid-assessments/new?type=${type}`)
  }

  const handleSubmit = async (payload: AssessmentFormSubmitPayload) => {
    setIsSubmitting(true)
    try {
      if (!token || !user) {
        throw new Error('Not authenticated')
      }

      // The dynamic form returns the full answers payload (entityId included).
      if (!payload.entityId) {
        throw new Error('Please select an entity for the assessment')
      }
      setSelectedEntityId(payload.entityId)

      const result = await apiPost('/api/v1/rapid-assessments', payload)
      if (!result.success) {
        throw new Error(result.error || 'Failed to submit assessment')
      }
      const d = result.data as any
      const assessmentId = d?.data?.id || d?.id
      
      setAssessmentId(assessmentId)
      setShowSuccess(true)
    } catch (error) {
      console.error('Error submitting assessment:', error)
      throw error
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = () => {
    router.push('/rapid-assessments')
  }

  const renderAssessmentForm = () => {
    if (!selectedType) return null

    return (
      <DynamicAssessmentForm
        assessmentType={selectedType}
        entityId={selectedEntityId || undefined}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    )
  }

  if (showSuccess) {
    return (
      <RoleBasedRoute requiredRole="ASSESSOR">
        <div className="max-w-2xl mx-auto py-8">
          <Card>
            <CardHeader className="text-center">
              <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
              <CardTitle className="text-2xl">Assessment Submitted Successfully!</CardTitle>
              <CardDescription>
                Your {selectedType} assessment has been submitted and is being processed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {assessmentId && (
                <div className="text-center p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-muted-foreground">Assessment ID:</p>
                  <p className="font-mono text-lg" data-testid="assessment-id">{assessmentId}</p>
                </div>
              )}
              <div className="flex gap-4">
                <Link href="/rapid-assessments">
                  <Button variant="outline" className="flex-1">
                    Back to Assessments
                  </Button>
                </Link>
                <Button 
                  className="flex-1" 
                  onClick={() => {
                    setShowSuccess(false)
                    setSelectedType('')
                    setAssessmentId(null)
                  }}
                >
                  Create Another Assessment
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </RoleBasedRoute>
    )
  }

  return (
    <RoleBasedRoute requiredRole="ASSESSOR">
      <div className="max-w-4xl mx-auto py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/rapid-assessments">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Assessments
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-foreground">New Rapid Assessment</h1>
            <p className="text-muted-foreground mt-1 hidden sm:block">
              Create a new rapid assessment for affected communities
            </p>
          </div>
        </div>

        {!selectedType ? (
          /* Assessment Type Selection */
          <Card>
            <CardHeader>
              <CardTitle>Select Assessment Type</CardTitle>
              <CardDescription>
                Choose the type of assessment you want to conduct
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                {assessmentTypes.map((type) => (
                  <div
                    key={type.value}
                    onClick={() => handleTypeSelect(type.value as AssessmentType)}
                    className="p-4 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                  >
                    <h3 className="font-medium mb-2">{type.label}</h3>
                    <p className="text-sm text-muted-foreground">{type.description}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : (
          /* Assessment Form */
          renderAssessmentForm()
        )}
      </div>
    </RoleBasedRoute>
  )
}

export default function NewRapidAssessmentPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <NewRapidAssessmentContent />
    </Suspense>
  )
}