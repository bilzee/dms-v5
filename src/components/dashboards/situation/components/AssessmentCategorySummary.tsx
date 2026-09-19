'use client';

import React, { useMemo, useState } from 'react';
import { cn, formatNumber, formatArrayValue } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getBadgeClasses } from '@/components/shared/StatusBadge';
import { Calendar, User, AlertTriangle, CheckCircle, Info, AlertCircle, Heart, Wheat, Droplets, Home, Shield, Users } from '@/lib/icons';
import { GapIndicator } from './GapIndicator';
import type { CategoryGapRow, CategoryGapSummary, SummaryQuestionMeta } from '@/lib/questions/gap-summary';

interface AssessmentCategorySummaryProps {
  category: 'health' | 'food' | 'wash' | 'shelter' | 'security' | 'population';
  /** Typed assessment data (individual) or per-type aggregate object (aggregated). */
  assessment: any;
  /** Stored P3 gap-engine result (individual mode: badge fallback + recommendations). */
  gapAnalysis?: any;
  layout: 'split' | 'full';
  className?: string;
  showRecommendations?: boolean;
  isAggregated?: boolean;
  /** P7 ranked summary — aggregated cards get it from the route; individual cards get one built from the stored gapAnalysis. */
  gapSummary?: CategoryGapSummary;
  /** Live registry projection for this type (labels/meanings/orders). */
  questions?: SummaryQuestionMeta[];
}

// Category configuration
const categoryConfig = {
  health: {
    title: 'Health Assessment',
    Icon: Heart,
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200'
  },
  food: {
    title: 'Food Security',
    Icon: Wheat,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200'
  },
  wash: {
    title: 'WASH (Water & Sanitation)',
    Icon: Droplets,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200'
  },
  shelter: {
    title: 'Shelter & Housing',
    Icon: Home,
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200'
  },
  security: {
    title: 'Security & Protection',
    Icon: Shield,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200'
  },
  population: {
    title: 'Population Overview',
    Icon: Users,
    color: 'text-muted-foreground',
    bgColor: 'bg-muted',
    borderColor: 'border-border'
  }
} as const;

// Units mapping for numeric fields
const fieldUnits = {
  // Health
  numberHealthFacilities: 'facilities',
  qualifiedHealthWorkers: 'workers',

  // Food
  availableFoodDurationDays: 'days',
  additionalFoodRequiredPersons: 'persons',
  additionalFoodRequiredHouseholds: 'households',

  // WASH
  functionalLatrinesAvailable: 'latrines',

  // Shelter
  numberSheltersRequired: 'shelters',

  // Population
  totalPopulation: 'people',
  totalHouseholds: 'households',
  populationMale: 'people',
  populationFemale: 'people',
  populationUnder5: 'children',
  pregnantWomen: 'women',
  lactatingMothers: 'mothers',
  personWithDisability: 'people',
  elderlyPersons: 'people',
  separatedChildren: 'children',
  numberLivesLost: 'lives',
  numberInjured: 'people'
} as const;

/**
 * AssessmentCategorySummary Component (P7)
 *
 * Renders one assessment-type card from RANKED registry-derived gap rows
 * (never a standing enumeration of hardcoded fields):
 * - Aggregated ("All Entities") mode: `gapSummary` from the situation route —
 *   ranked rows with spread-count chips, an expandable
 *   `+{hidden} more · {count} {SEV}` overflow chip (all overflow rows are
 *   carried in `rows`), and a computation-timestamp stamp.
 * - Individual-entity mode: `gapSummary` built client-side from the STORED
 *   gapAnalysis joined with `questions` metadata; same ranking/limit/chip,
 *   spread locked to 1, no stamp. Context box from CONTEXT metadata + values.
 * - Zero confirmed gaps render a collapsed variant (title + green
 *   "No Gaps" badge, no row list).
 */

const severityIconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  CRITICAL: AlertTriangle,
  HIGH: AlertCircle,
  MEDIUM: Info,
  LOW: Info
};

const severityFlashMap: Record<string, string> = {
  CRITICAL: 'animate-pulse',
  HIGH: 'animate-pulse',
  MEDIUM: '',
  LOW: ''
};

export function AssessmentCategorySummary({
  category,
  assessment,
  gapAnalysis,
  layout = 'split',
  className,
  showRecommendations = false,
  isAggregated = false,
  gapSummary,
  questions
}: AssessmentCategorySummaryProps) {
  const config = categoryConfig[category];
  const [expanded, setExpanded] = useState(false);

  // Header badge derives from the ranked summary when present (aggregated and
  // individual alike); the stored gapAnalysis remains the individual fallback.
  const hasGap = gapSummary ? gapSummary.hasGaps : Boolean(gapAnalysis?.hasGap);
  const overallSeverity = gapSummary
    ? gapSummary.overallSeverity
    : (gapAnalysis?.severity as string | undefined);

  // Collapsed view shows rows.length - hiddenCount rows; expanding reveals
  // every overflow row (the summary carries them all).
  const visibleRows = useMemo(() => {
    if (!gapSummary) return [];
    const collapsedCount = gapSummary.rows.length - gapSummary.hiddenCount;
    return expanded ? gapSummary.rows : gapSummary.rows.slice(0, collapsedCount);
  }, [gapSummary, expanded]);

  const contextQuestions = useMemo(
    () => (questions ?? []).filter((question) => question.category === 'CONTEXT'),
    [questions]
  );

  if (!assessment) {
    return (
      <Card className={cn("opacity-60 border-dashed border-2", config.borderColor, className)}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-muted-foreground">
            <config.Icon className={cn("h-4 w-4 opacity-50", config.color)} />
            {config.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <div className="text-2xl mb-2 opacity-50">📋</div>
            <p className="text-sm font-medium">Assessment Missing</p>
            <p className="text-xs mt-1">This assessment hasn&apos;t been completed yet</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const formatContextValue = (key: string): string => {
    const value = assessment[key];

    if (typeof value === 'number') {
      return formatNumber(value);
    }
    if (typeof value === 'object' && value !== null) {
      return formatArrayValue(value);
    }
    if (typeof value === 'string' && (value.startsWith('[') || value.includes(','))) {
      return formatArrayValue(value);
    }
    return value ? String(value) : 'N/A';
  };

  const unitFor = (key: string): string => {
    const fieldKey = key as keyof typeof fieldUnits;
    return fieldUnits[fieldKey] || '';
  };

  const renderGapRow = (row: CategoryGapRow, showSpread: boolean) => (
    <div key={row.key} className="py-1">
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-sm text-muted-foreground flex-1 min-w-0 truncate"
          title={row.meaning || row.label}
        >
          {row.label}
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {showSpread && row.total > 0 && (
            <span className="text-[11px] text-muted-foreground bg-muted px-2 py-1 rounded">
              {row.spread}
            </span>
          )}
          <GapIndicator hasGap severity={row.severity} size="sm" badgeMode="initial" />
        </div>
      </div>
    </div>
  );

  const renderOverflowChip = () => {
    if (!gapSummary || gapSummary.hiddenCount <= 0) return null;
    const hint = gapSummary.hiddenSeverityHint;
    return (
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="mt-1 text-xs text-blue-600 hover:text-blue-800 hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1"
        aria-expanded={expanded}
      >
        {expanded
          ? 'Show fewer'
          : `+${gapSummary.hiddenCount} more${hint ? ` · ${hint.count} ${hint.severity}` : ''}`}
      </button>
    );
  };

  const renderRankedRows = (showSpread: boolean) => {
    if (!gapSummary) {
      return (
        <div className="text-center py-4 text-muted-foreground bg-muted rounded-lg">
          <Info className="h-6 w-6 mx-auto mb-2 opacity-50" />
          <p className="text-xs">No gap data</p>
        </div>
      );
    }

    if (!gapSummary.hasGaps) {
      // Collapsed zero-gap variant — never an empty row list.
      return (
        <div className="text-center py-4 text-green-700 bg-green-50 rounded-lg border border-green-200">
          <CheckCircle className="h-6 w-6 mx-auto mb-2 text-green-500" />
          <p className="text-xs">
            {isAggregated ? 'No gaps across all entities' : 'No gaps detected'}
          </p>
        </div>
      );
    }

    return (
      <div>
        {visibleRows.map((row) => renderGapRow(row, showSpread))}
        {renderOverflowChip()}
      </div>
    );
  };

  const renderStamp = () => {
    if (!isAggregated || !gapSummary?.stamp) return null;
    const computedAt = new Date(gapSummary.stamp.computedAt).toLocaleString();
    return (
      <p className="text-[10px] text-muted-foreground mt-3" data-testid="gap-summary-stamp">
        {computedAt}
      </p>
    );
  };

  const renderContextBox = () => (
    <div className="space-y-2">
      {contextQuestions.length > 0 ? (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <h4 className="text-sm font-semibold text-blue-800 mb-3 flex items-center gap-2">
            <Info className="h-4 w-4" />
            Context
          </h4>
          <div className="space-y-1">
            {contextQuestions.map((question) => {
              const unit = unitFor(question.key);
              return (
                <div key={question.key} className="flex items-center justify-between py-0.5">
                  <div className="text-muted-foreground font-medium uppercase tracking-wide leading-tight" style={{ fontSize: '8px' }}>
                    {question.label}
                  </div>
                  <div className="text-sm font-medium text-foreground">
                    {formatContextValue(question.key)}
                    {unit && <span className="text-xs text-muted-foreground ml-1">{unit}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="text-center py-4 text-muted-foreground bg-muted rounded-lg">
          <Info className="h-6 w-6 mx-auto mb-2 opacity-50" />
          <p className="text-xs">No overview data</p>
        </div>
      )}
    </div>
  );

  return (
    <Card className={cn(className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <config.Icon className={cn("h-4 w-4", config.color)} />
            {config.title}
          </CardTitle>
          {(hasGap || gapAnalysis) && (
            <div className="flex items-center gap-2">
              {hasGap && overallSeverity ? (
                (() => {
                  const IconComponent = severityIconMap[overallSeverity] || Info;
                  const badgeClass = getBadgeClasses('severity', overallSeverity);
                  return (
                    <Badge
                      variant="outline"
                      className={cn("text-xs font-bold", badgeClass, severityFlashMap[overallSeverity] || '')}
                    >
                      <IconComponent className="h-3 w-3 mr-1" />
                      {overallSeverity}
                    </Badge>
                  );
                })()
              ) : (
                <Badge
                  variant="outline"
                  className={cn("text-xs font-bold", getBadgeClasses('severity', 'LOW'))}
                >
                  <CheckCircle className="h-3 w-3 mr-1" />
                  No Gaps
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* Assessment metadata */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {assessment.rapidAssessmentDate && (
            <div className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {new Date(assessment.rapidAssessmentDate).toLocaleDateString()}
            </div>
          )}
          {assessment.assessorName && (
            <div className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {assessment.assessorName}
            </div>
          )}
          {isAggregated && typeof assessment.totalEntities === 'number' && (
            <div className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {assessment.totalEntities} {assessment.totalEntities === 1 ? 'entity' : 'entities'}
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {isAggregated ? (
          // Aggregated view — ranked gap rows only (registry-derived),
          // overflow chip, and the registry stamp.
          <div className="space-y-2">
            {gapSummary?.hasGaps && (
              <h4 className="text-sm font-medium text-foreground mb-2">Gap Analysis (All Entities)</h4>
            )}
            {renderRankedRows(true)}
            {renderStamp()}
          </div>
        ) : layout === 'split' ? (
          <div className="space-y-4">
            {/* Ranked gap rows (top section) */}
            <div className="space-y-2">
              <div className="border border-border rounded-lg p-3">
                <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Gap Analysis
                </h4>
                {renderRankedRows(false)}
              </div>
            </div>

            {/* Context box from CONTEXT metadata + assessment values */}
            {renderContextBox()}
          </div>
        ) : (
          // Full layout - context rows and ranked gap rows together
          <div className="space-y-4">
            <div className="space-y-1">
              {contextQuestions.map((question) => {
                const unit = unitFor(question.key);
                return (
                  <div key={question.key} className="flex items-center justify-between py-1">
                    <span className="text-sm text-muted-foreground flex-1">{question.label}</span>
                    <span className="text-sm font-semibold text-foreground bg-muted px-2 py-1 rounded text-right min-w-0 flex-shrink-0">
                      {formatContextValue(question.key)}
                      {unit && <span className="text-xs text-muted-foreground ml-1">{unit}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-medium text-foreground mb-2">Gap Analysis</h4>
              {renderRankedRows(false)}
            </div>
          </div>
        )}

        {/* Recommendations - only show if enabled */}
        {showRecommendations && gapAnalysis?.recommendations && gapAnalysis.recommendations.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <h4 className="text-sm font-medium text-foreground mb-2">Recommendations</h4>
            <ul className="space-y-1">
              {gapAnalysis.recommendations.map((recommendation: string, index: number) => (
                <li key={index} className="text-xs text-muted-foreground flex items-start gap-1">
                  <span className="text-blue-500 mt-0.5">•</span>
                  {recommendation}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default AssessmentCategorySummary;
