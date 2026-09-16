'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { RoleBasedRoute } from '@/components/shared/RoleBasedRoute'
import { AssessmentOfflineGuard } from '@/components/offline/OfflineGuard'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ArrowLeft, AlertTriangle, CheckCircle, Hospital, Users, Utensils, Droplets, Home, Shield } from '@/lib/icons'
import { useAuth } from '@/hooks/useAuth'
import { apiGet } from '@/lib/api'
import { assessmentOfflineService } from '@/lib/services/assessment-offline.service'

// Registry-driven assessment form (P4) — one component for every type
import { DynamicAssessmentForm, type AssessmentFormSubmitPayload } from '@/components/forms/assessment/DynamicAssessmentForm'
import type { RapidAssessmentType } from '@/lib/questions/answers'

const assessmentTypes = [
  { 
    value: 'HEALTH', 
    label: 'Health Assessment', 
    color: 'bg-red-100 text-red-800',
    icon: Hospital,
    description: 'Medical facilities, services, and health conditions'
  },
  { 
    value: 'POPULATION', 
    label: 'Population Assessment', 
    color: 'bg-blue-100 text-blue-800',
    icon: Users,
    description: 'Demographics, displacement, and population needs'
  },
  { 
    value: 'FOOD', 
    label: 'Food Security Assessment', 
    color: 'bg-orange-100 text-orange-800',
    icon: Utensils,
    description: 'Food availability, access, and nutrition status'
  },
  { 
    value: 'WASH', 
    label: 'WASH Assessment', 
    color: 'bg-cyan-100 text-cyan-800',
    icon: Droplets,
    description: 'Water, sanitation, and hygiene conditions'
  },
  { 
    value: 'SHELTER', 
    label: 'Shelter Assessment', 
    color: 'bg-purple-100 text-purple-800',
    icon: Home,
    description: 'Housing, shelter conditions, and accommodation needs'
  },
  { 
    value: 'SECURITY', 
    label: 'Security Assessment', 
    color: 'bg-gray-100 text-gray-800',
    icon: Shield,
    description: 'Safety, security situation, and protection needs'
  }
]

function NewAssessmentContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { token, user } = useAuth()
  const [selectedType, setSelectedType] = useState<string>('')
  const [showForm, setShowForm] = useState(false)
  const [latestAssessmentData, setLatestAssessmentData] = useState<any>(null)
  const prefillEntityId = searchParams.get('entityId') || ''
  const prefillIncidentId = searchParams.get('incidentId') || ''
  const signalReason = searchParams.get('signalReason') || ''

  useEffect(() => {
    const typeParam = searchParams.get('type')
    if (typeParam && assessmentTypes.find(t => t.value === typeParam)) {
      setSelectedType(typeParam)
      setShowForm(true)
    }
  }, [searchParams])

  useEffect(() => {
    if (prefillEntityId && prefillIncidentId && selectedType) {
      fetchLatestAssessment(prefillIncidentId, prefillEntityId, selectedType)
    }
  }, [prefillEntityId, prefillIncidentId, selectedType])

  // Fetch latest assessment data when incident and entity are selected
  const fetchLatestAssessment = async (incidentId: string, entityId: string, assessmentType: string) => {
    try {
      const result = await apiGet(
        `/api/v1/rapid-assessments/latest?incidentId=${incidentId}&entityId=${entityId}&type=${assessmentType}`
      );
      
      if (result.success && result.data) {
        console.log('Setting latest assessment data:', result.data);
        setLatestAssessmentData(result.data);
      }
    } catch (error) {
      console.error('Error fetching latest assessment:', error);
    }
  };

  const selectedAssessment = assessmentTypes.find(t => t.value === selectedType)

  const handleGoBack = () => {
    if (showForm) {
      setShowForm(false)
      setSelectedType('')
      // Clear the type parameter
      const url = new URL(window.location.href)
      url.searchParams.delete('type')
      window.history.replaceState({}, '', url.toString())
    } else {
      router.push('/assessor/rapid-assessments')
    }
  }

  const handleAssessmentComplete = () => {
    // Trigger a storage event to notify other tabs to refresh their data
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'assessment-created',
      newValue: Date.now().toString()
    }))
    
    router.push('/assessor/rapid-assessments')
  }

  const renderAssessmentForm = () => {
    const handleAssessmentSubmit = async (payload: AssessmentFormSubmitPayload) => {
      try {
        console.log('Submitting assessment data:', payload)

        // Answers-based payload — validated client-side against the live
        // registry and server-side against the frozen snapshot. No priority:
        // the server derives it (p3).
        const result = await assessmentOfflineService.createAssessment(payload, user?.id || 'unknown')
        console.log('Assessment submitted successfully:', result)
        handleAssessmentComplete()
      } catch (error) {
        console.error('Error submitting assessment:', error)
        throw error
      }
    }

    const isReassessment = signalReason === 'reassessment-needed' || !!latestAssessmentData
    const previousAssessmentDate = latestAssessmentData?.rapidAssessmentDate
      ? new Date(latestAssessmentData.rapidAssessmentDate).toLocaleDateString()
      : undefined

    return (
      <DynamicAssessmentForm
        assessmentType={selectedType as RapidAssessmentType}
        entityId={prefillEntityId || undefined}
        incidentId={prefillIncidentId || undefined}
        initialAnswers={latestAssessmentData?.answers ?? null}
        onSubmit={handleAssessmentSubmit}
        onCancel={handleGoBack}
        lockIncidentEntity={!!(prefillEntityId && prefillIncidentId)}
        isReassessment={isReassessment}
        previousAssessmentDate={previousAssessmentDate}
      />
    )
  }

  return (
    <RoleBasedRoute requiredRole="ASSESSOR">
      <AssessmentOfflineGuard>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center gap-4">
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleGoBack}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              {showForm ? 'Back to Selection' : 'Back to Assessments'}
            </Button>
          
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              {showForm ? `${selectedAssessment?.label}` : 'Create New Assessment'}
            </h1>
            <p className="text-muted-foreground mt-2 hidden sm:block">
              {showForm 
                ? `Complete the ${selectedAssessment?.label.toLowerCase()} form below`
                : 'Select the type of assessment you want to create'
              }
            </p>
          </div>

          {selectedAssessment && showForm && (
            <Badge className={selectedAssessment.color}>
              {selectedAssessment.icon && <selectedAssessment.icon className="h-4 w-4 mr-2" />}
              {selectedAssessment.value}
            </Badge>
          )}
        </div>

        {showForm && selectedAssessment ? (
          <div className="space-y-6">
            {/* Assessment Form */}
            {renderAssessmentForm()}
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Assessment Type</CardTitle>
              <CardDescription>
                Choose the type of rapid assessment you want to conduct
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {assessmentTypes.map((type) => {
                  const Icon = type.icon
                  return (
                    <div
                      key={type.value}
                      onClick={() => {
                        setSelectedType(type.value)
                        setShowForm(true)
                        // Update URL with type parameter
                        const url = new URL(window.location.href)
                        url.searchParams.set('type', type.value)
                        window.history.replaceState({}, '', url.toString())
                      }}
                      className="p-4 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <div className="p-2 rounded-lg bg-gray-100">
                            <Icon className="h-5 w-5 text-foreground" />
                          </div>
                          <div className="flex-1">
                            <h3 className="font-medium">{type.label}</h3>
                            <p className="text-sm text-muted-foreground mt-1">
                              {type.description}
                            </p>
                          </div>
                        </div>
                        <Badge className={type.color}>
                          {type.value}
                        </Badge>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}
        </div>
      </AssessmentOfflineGuard>
    </RoleBasedRoute>
  )
}

export default function NewAssessmentPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <NewAssessmentContent />
    </Suspense>
  )
}
