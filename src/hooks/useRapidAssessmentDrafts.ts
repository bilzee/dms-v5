'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { DRAFTS_STORAGE_KEY } from '@/lib/questions/draft-migration'

export interface RapidAssessmentDraft {
  id: string
  assessmentType: string
  entityId: string
  incidentId: string
  data: Record<string, unknown>
  timestamp: number
  autoSaved: boolean
}


const MAX_DRAFTS = 5

function loadDrafts(): RapidAssessmentDraft[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(DRAFTS_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function persistDrafts(drafts: RapidAssessmentDraft[]) {
  try {
    localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(drafts))
  } catch {
    // localStorage may be full or unavailable
  }
}

export function useRapidAssessmentDrafts(assessmentType: string) {
  const [drafts, setDrafts] = useState<RapidAssessmentDraft[]>([])
  const [currentDraft, setCurrentDraft] = useState<RapidAssessmentDraft | null>(null)

  useEffect(() => {
    const all = loadDrafts().filter(d => d.assessmentType === assessmentType)
    setDrafts(all)
  }, [assessmentType])

  const saveDraft = useCallback(
    (data: Record<string, unknown>, entityId: string, incidentId: string, autoSaved: boolean) => {
      const draft: RapidAssessmentDraft = {
        id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        assessmentType,
        entityId,
        incidentId,
        data,
        timestamp: Date.now(),
        autoSaved,
      }

      setDrafts(prev => {
        const allRaw = loadDrafts()
        const others = allRaw.filter(d => d.id !== currentDraft?.id && d.assessmentType !== assessmentType ? true : d.id !== currentDraft?.id)
        const sameType = allRaw.filter(d => d.assessmentType === assessmentType && d.id !== currentDraft?.id)
        const updated = [draft, ...sameType].slice(0, MAX_DRAFTS)
        persistDrafts([...others, ...updated])
        return updated
      })
      setCurrentDraft(draft)
    },
    [assessmentType, currentDraft]
  )

  const loadDraft = useCallback((id: string) => {
    const all = loadDrafts()
    const found = all.find(d => d.id === id)
    if (found) setCurrentDraft(found)
  }, [])

  const deleteDraft = useCallback((id: string) => {
    setDrafts(prev => {
      const filtered = prev.filter(d => d.id !== id)
      const allRaw = loadDrafts()
      persistDrafts(allRaw.filter(d => d.id !== id))
      return filtered
    })
    setCurrentDraft(curr => (curr?.id === id ? null : curr))
  }, [])

  const clearCurrentDraft = useCallback(() => setCurrentDraft(null), [])

  return {
    drafts,
    currentDraft,
    saveDraft,
    loadDraft,
    deleteDraft,
    clearCurrentDraft,
  }
}

export function useRapidAssessmentAutoSave(
  isDirty: boolean,
  watch: () => Record<string, unknown>,
  saveDraft: (data: Record<string, unknown>, autoSaved: boolean) => void,
  intervalMs = 30000
) {
  const savedRef = useRef(false)

  useEffect(() => {
    if (!isDirty) return
    const interval = setInterval(() => {
      const formData = watch()
      saveDraft(formData, true)
      savedRef.current = true
    }, intervalMs)
    return () => clearInterval(interval)
  }, [isDirty, watch, saveDraft, intervalMs])

  return savedRef
}
