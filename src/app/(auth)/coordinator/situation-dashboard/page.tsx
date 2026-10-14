'use client';

import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { SituationDashboardLayout } from '@/components/dashboards/situation/SituationDashboardLayout';
import { IncidentOverviewPanel } from '@/components/dashboards/situation/IncidentOverviewPanel';
import { CoordinatorPanelLayout } from '@/components/dashboards/situation/layouts/CoordinatorPanelLayout';
import { ExecutivePanelLayout } from '@/components/dashboards/situation/layouts/ExecutivePanelLayout';
import { AggregateMetrics } from '@/components/dashboards/situation/components/AggregateMetrics';
import { TopDonorsSection } from '@/components/dashboards/situation/components/TopDonorsSection';
import { ModeToggle, type DashboardMode } from '@/components/dashboards/situation/shared/ModeToggle';
import { ZoomAdjustmentHint } from '@/components/dashboards/situation/shared/ZoomAdjustmentHint';
import { useIncidentSelection, useIncidentActions } from '@/stores/dashboardLayout.store';
import { apiGet } from '@/lib/api';
import { ExportButton } from '@/components/dashboards/shared/exports/ExportButton';

// Fetch incident data for dynamic incident name
const fetchIncidentData = async (incidentId: string) => {
  const response = await apiGet(`/api/v1/dashboard/situation?incidentId=${incidentId}`);
  if (!response.success) {
    throw new Error(response.error || 'Failed to fetch incident data');
  }
  return response.data;
};


/**
 * Coordinator Situation Dashboard Page
 * 
 * This page provides a comprehensive situation awareness dashboard with three panels:
 * - Left Panel: Incident Overview (Story 7.2) - IMPLEMENTED
 * - Center Panel: Divided into two sections:
 *   - Upper Center: Entity Assessment (Story 7.3) - IMPLEMENTED
 *   - Lower Center: Interactive Map (MapLibre) from entity-incident-map - NEW
 * - Right Panel: Aggregate Metrics (moved from left panel)
 * 
 * The map dynamically updates based on the selected incident from the left panel.
 * Map component dynamically imported for client-side rendering (SSR-safe).
 */
export default function SituationDashboardPage() {
  // Dashboard mode state management
  const [dashboardMode, setDashboardMode] = useState<DashboardMode>('coordinator');
  
  // State management for selected incident
  const { selectedIncidentId } = useIncidentSelection();
  const { setSelectedIncident } = useIncidentActions();

  // Handle mode change
  const handleModeChange = (newMode: DashboardMode) => {
    setDashboardMode(newMode);
  };
  
  // Fetch the first active incident from the API instead of hardcoding
  useEffect(() => {
    if (!selectedIncidentId) {
      const fetchDefaultIncident = async () => {
        try {
          const result = await apiGet('/api/v1/incidents?status=ACTIVE&limit=1')
          if (result.success && result.data) {
            const incidents = result.data.incidents || result.data
            const firstActive = Array.isArray(incidents) && incidents.length > 0 ? incidents[0] : null
            const incidentId = firstActive?.id || firstActive?.incidentId || ''
            if (incidentId) {
              setSelectedIncident(incidentId)
            }
          }
        } catch (error) {
          console.error('Error fetching default incident:', error)
        }
      }
      fetchDefaultIncident()
    }
  }, [selectedIncidentId, setSelectedIncident])

  const currentIncidentId = selectedIncidentId || '';

  return (
    <div className="situation-dashboard-zoom w-full h-screen overflow-hidden">
        {/* Enhanced header with mode toggle */}
        <div className="mb-2 px-1 py-2 bg-white border-b border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h1 className="text-base font-semibold text-gray-900">Situation Dashboard</h1>
              <p className="text-xs text-gray-500">
                Real-time disaster situation monitoring and analysis
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ExportButton dataType="incidents" size="sm" />
              <ModeToggle 
                mode={dashboardMode} 
                onModeChange={handleModeChange}
                className="flex-shrink-0"
              />
            </div>
          </div>
        </div>
        
        {/* Zoom adjustment hint */}
        <ZoomAdjustmentHint />

        {/* Dynamic dashboard layout */}
        <div className="relative w-full h-full">
          <SituationDashboardLayout>
          {/* Left Panel: Incident Overview */}
          <div>
            <IncidentOverviewPanel
              incidentId={currentIncidentId}
              onIncidentChange={(incidentId) => {
                console.log('Incident changed to:', incidentId);
                setSelectedIncident(incidentId);
              }}
              dashboardMode={dashboardMode}
              className="h-full"
            />
          </div>

          {/* Dynamic Center Panel */}
          <div className="relative h-full">
              {dashboardMode === 'coordinator' ? (
                <CoordinatorPanelLayout
                  incidentId={currentIncidentId}
                  onIncidentChange={setSelectedIncident}
                  onEntityChange={(entityId) => {
                    console.log('Entity changed to:', entityId);
                  }}
                />
              ) : (
                <ExecutivePanelLayout
                  incidentId={currentIncidentId}
                  onIncidentChange={setSelectedIncident}
                  onEntityChange={(entityId) => {
                    console.log('Entity changed to:', entityId);
                  }}
                />
              )}
          </div>

          {/* Right Panel: Aggregate Metrics + Top Donors */}
          <div className="flex flex-col h-full space-y-4 p-4">
            <AggregateMetrics
              incidentId={currentIncidentId}
              className="flex-shrink-0"
            />
            <TopDonorsSection
              incidentId={currentIncidentId}
              className="flex-shrink-0"
            />
          </div>
          </SituationDashboardLayout>
        </div>
      </div>
  );
}