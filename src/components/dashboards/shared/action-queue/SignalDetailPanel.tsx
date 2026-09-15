'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  X,
  FileText,
  Package,
  DollarSign,
  Clock,
  User,
  MapPin,
  CheckCircle,
  AlertTriangle,
  Heart,
  ShieldCheck,
  Truck,
  Droplets,
  Home,
  Utensils,
  Users,
} from '@/lib/icons';
import { useSignalDetail, resolveDetailRef } from '@/hooks/useSignalDetail';
import { useCurrencySymbol } from '@/hooks/useCurrency';
import { SignalPriorityBadge } from './SignalPriorityBadge';
import { REASON_LABELS } from './SignalReasonIcon';
import type { ActionSignalItem, SignalReason } from '@/types/action-signal';
import { fromAnswers, RapidAssessmentAnswers, RapidAssessmentType } from '@/lib/questions/legacy-convert';

interface SignalDetailPanelProps {
  signal: ActionSignalItem | null;
  onClose: () => void;
  className?: string;
}

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  HEALTH: Heart,
  WASH: Droplets,
  SHELTER: Home,
  FOOD: Utensils,
  SECURITY: ShieldCheck,
  POPULATION: Users,
  LOGISTICS: Truck,
};

const VERIFICATION_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  SUBMITTED: 'bg-yellow-100 text-yellow-800',
  VERIFIED: 'bg-green-100 text-green-800',
  AUTO_VERIFIED: 'bg-blue-100 text-blue-800',
  REJECTED: 'bg-red-100 text-red-800',
};

const COMMITMENT_COLORS: Record<string, string> = {
  PLANNED: 'bg-blue-100 text-blue-800',
  PARTIAL: 'bg-yellow-100 text-yellow-800',
  COMPLETE: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-gray-100 text-gray-700',
};

export function SignalDetailPanel({ signal, onClose, className }: SignalDetailPanelProps) {
  const { data: detail, isLoading, error } = useSignalDetail(signal);
  const symbol = useCurrencySymbol();

  if (!signal) return null;

  const isOpen = !!signal;
  const TypeIcon = TYPE_ICONS[signal.type] || FileText;
  const ref = resolveDetailRef(signal);
  const hasDetailRef = !!ref.type && !!ref.id;

  return (
    <div
      className={cn(
        'fixed inset-y-0 right-0 z-50 w-full sm:w-[640px] bg-card border-l shadow-xl transform transition-transform duration-300 ease-in-out',
        isOpen ? 'translate-x-0' : 'translate-x-full',
        className,
      )}
    >
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="shrink-0 px-5 py-4 border-b bg-muted/30">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <TypeIcon className="h-5 w-5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {signal.type}
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <h2 className="text-lg font-semibold text-foreground leading-tight">
            {REASON_LABELS[signal.signalReason] || signal.signalReason}
          </h2>
          <div className="flex items-center gap-2 mt-2">
            <SignalPriorityBadge priority={signal.priority as any} />
            <span className="text-sm text-muted-foreground">
              {signal.entity?.name || 'Unknown Entity'}
            </span>
          </div>
          {signal.incident?.name && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <AlertTriangle className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{signal.incident.name}</span>
              {signal.incident.severity && (
                <Badge variant="outline" className="text-[10px] px-1 py-0 ml-1">
                  {signal.incident.severity}
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* Content */}
        <ScrollArea className="flex-1">
          <div className="p-5 space-y-5">
            {!hasDetailRef && !isLoading && (
              <EntitySignalFallback signal={signal} />
            )}
            {hasDetailRef && isLoading && <DetailSkeleton />}
            {hasDetailRef && error && <DetailError message={error instanceof Error ? error.message : 'Failed to load details'} />}
            {hasDetailRef && detail && !isLoading && (
              detail.type === 'assessment' ? (
                <AssessmentDetail data={detail.data} />
              ) : detail.type === 'response' ? (
                <ResponseDetail data={detail.data} />
              ) : detail.type === 'commitment' ? (
                <CommitmentDetail data={detail.data} />
              ) : null
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-6 w-3/4" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="space-y-3">
        {[1, 2, 3, 4].map(i => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}

function DetailError({ message }: { message: string }) {
  return (
    <div className="text-center py-8">
      <AlertTriangle className="h-8 w-8 text-yellow-500 mx-auto mb-3" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-2">
      {children}
    </label>
  );
}

function FieldRow({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex items-start justify-between py-1.5">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />}
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <span className="text-sm font-medium text-foreground text-right max-w-[60%]">{value}</span>
    </div>
  );
}

function BadgeField({ label, value, colorClass }: { label: string; value: string; colorClass?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <Badge variant="secondary" className={cn('text-xs', colorClass)}>{value}</Badge>
    </div>
  );
}

function JsonKeyValue({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-1.5">
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="bg-muted/50 px-3 py-2 rounded-md text-sm flex items-center justify-between">
          <span className="capitalize text-muted-foreground">{key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')}</span>
          <span className="font-medium text-foreground">
            {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value ?? '—')}
          </span>
        </div>
      ))}
    </div>
  );
}

function ItemsTable({ items }: { items: any[] }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div className="border rounded-md overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50">
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Item</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Qty</th>
            {items[0]?.unit && <th className="px-3 py-2 text-left font-medium text-muted-foreground">Unit</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i} className="border-t">
              <td className="px-3 py-2">{item.name || item.itemName || `Item ${i + 1}`}</td>
              <td className="px-3 py-2 text-right font-medium">{item.quantity ?? item.plannedQuantity ?? '—'}</td>
              {items[0]?.unit && <td className="px-3 py-2 text-muted-foreground">{item.unit || ''}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TimestampField({ label, date }: { label: string; date: string | Date | null | undefined }) {
  if (!date) return null;
  return <FieldRow label={label} value={new Date(date).toLocaleString()} icon={Clock} />;
}

function AssessmentDetail({ data }: { data: any }) {
  if (!data) return <DetailError message="No assessment data available" />;

  const subAssessment =
    data.healthAssessment || data.washAssessment || data.shelterAssessment ||
    data.foodAssessment || data.securityAssessment || data.populationAssessment ||
    // Hydrate the legacy typed payload view from the canonical answers map
    (data.answers && data.rapidAssessmentType
      ? fromAnswers(
          data.rapidAssessmentType as RapidAssessmentType,
          data.answers as RapidAssessmentAnswers
        )
      : undefined);

  const gapAnalysis = data.gapAnalysis;

  return (
    <div className="space-y-5">
      <SectionLabel>Assessment Overview</SectionLabel>
      <div className="bg-muted/30 rounded-lg p-4 space-y-1">
        <BadgeField label="Status" value={data.verificationStatus || 'DRAFT'} colorClass={VERIFICATION_COLORS[data.verificationStatus] || ''} />
        <BadgeField label="Priority" value={data.priority || 'MEDIUM'} />
        <FieldRow label="Type" value={data.rapidAssessmentType} icon={FileText} />
        <FieldRow label="Assessor" value={data.assessorName || data.assessor?.name || '—'} icon={User} />
        <FieldRow label="Entity" value={data.entity?.name || '—'} icon={MapPin} />
        <FieldRow label="Location" value={data.location || data.entity?.location || '—'} icon={MapPin} />
        <TimestampField label="Assessment Date" date={data.rapidAssessmentDate} />
        <TimestampField label="Submitted" date={data.createdAt} />
        {data.verifiedAt && <TimestampField label="Verified" date={data.verifiedAt} />}
        {data.rejectionReason && (
          <FieldRow label="Rejection Reason" value={data.rejectionReason} icon={X} />
        )}
      </div>

      {gapAnalysis && typeof gapAnalysis === 'object' && (
        <>
          <Separator />
          <SectionLabel>Gap Analysis</SectionLabel>
          {Array.isArray(gapAnalysis) ? (
            <div className="space-y-2">
              {gapAnalysis.map((gap: any, i: number) => (
                <div key={i} className="bg-muted/50 px-3 py-2 rounded-md">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{gap.category || `Gap ${i + 1}`}</span>
                    {gap.severity && <Badge variant="outline" className="text-[10px]">{gap.severity}</Badge>}
                  </div>
                  {gap.description && <p className="text-xs text-muted-foreground mt-1">{gap.description}</p>}
                </div>
              ))}
            </div>
          ) : (
            <JsonKeyValue data={gapAnalysis as Record<string, unknown>} />
          )}
        </>
      )}

      {subAssessment && (
        <>
          <Separator />
          <SectionLabel>Assessment Details</SectionLabel>
          <div className="space-y-1.5">
            {Object.entries(subAssessment)
              .filter(([k, v]) => v !== null && v !== undefined && v !== '' && !['id', 'rapidAssessmentId'].includes(k))
              .map(([k, v]) => {
                return (
                  <div key={k} className="bg-muted/50 px-3 py-2 rounded-md text-sm flex items-center justify-between">
                    <span className="capitalize text-muted-foreground">
                      {k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')}
                    </span>
                    <span className="font-medium text-foreground">
                      {typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}
                    </span>
                  </div>
                );
              })}
          </div>
        </>
      )}
    </div>
  );
}

function ResponseDetail({ data }: { data: any }) {
  if (!data) return <DetailError message="No response data available" />;

  const resources = data.resources;
  const items = data.items;
  const timeline = data.timeline;

  return (
    <div className="space-y-5">
      <SectionLabel>Response Plan Overview</SectionLabel>
      <div className="bg-muted/30 rounded-lg p-4 space-y-1">
        <BadgeField label="Status" value={data.verificationStatus || 'DRAFT'} colorClass={VERIFICATION_COLORS[data.verificationStatus] || ''} />
        <BadgeField label="Delivery" value={data.deliveryStatus || 'PLANNED'} />
        <BadgeField label="Priority" value={data.priority || 'MEDIUM'} />
        <FieldRow label="Type" value={data.type} icon={Package} />
        <FieldRow label="Responder" value={data.responder?.name || '—'} icon={User} />
        <FieldRow label="Entity" value={data.entity?.name || '—'} icon={MapPin} />
        <FieldRow label="Location" value={data.entity?.location || '—'} icon={MapPin} />
        <TimestampField label="Created" date={data.createdAt} />
        <TimestampField label="Planned Date" date={data.plannedDate} />
        {data.responseDate && <TimestampField label="Delivered" date={data.responseDate} />}
        {data.verifiedAt && <TimestampField label="Verified" date={data.verifiedAt} />}
        {data.rejectionReason && (
          <FieldRow label="Rejection Reason" value={data.rejectionReason} icon={X} />
        )}
      </div>

      {data.description && (
        <>
          <Separator />
          <SectionLabel>Description</SectionLabel>
          <p className="text-sm text-foreground bg-muted/30 p-3 rounded-md">{data.description}</p>
        </>
      )}

      {items && (Array.isArray(items) ? items.length > 0 : typeof items === 'object') && (
        <>
          <Separator />
          <SectionLabel>Planned Items</SectionLabel>
          {Array.isArray(items) ? (
            <ItemsTable items={items} />
          ) : (
            <JsonKeyValue data={items as Record<string, unknown>} />
          )}
        </>
      )}

      {resources && typeof resources === 'object' && (
        <>
          <Separator />
          <SectionLabel>Resources</SectionLabel>
          <JsonKeyValue data={resources as Record<string, unknown>} />
        </>
      )}

      {timeline && typeof timeline === 'object' && (
        <>
          <Separator />
          <SectionLabel>Timeline</SectionLabel>
          {Array.isArray(timeline) ? (
            <div className="space-y-2">
              {timeline.map((entry: any, i: number) => (
                <div key={i} className="bg-muted/50 px-3 py-2 rounded-md">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{entry.milestone || entry.phase || `Step ${i + 1}`}</span>
                    {entry.date && <span className="text-xs text-muted-foreground">{new Date(entry.date).toLocaleDateString()}</span>}
                  </div>
                  {entry.description && <p className="text-xs text-muted-foreground mt-1">{entry.description}</p>}
                </div>
              ))}
            </div>
          ) : (
            <JsonKeyValue data={timeline as Record<string, unknown>} />
          )}
        </>
      )}

      {data.assessment && (
        <>
          <Separator />
          <SectionLabel>Linked Assessment</SectionLabel>
          <div className="bg-muted/30 rounded-lg p-4 space-y-1">
            <FieldRow label="Type" value={data.assessment.rapidAssessmentType} icon={FileText} />
            <BadgeField label="Status" value={data.assessment.verificationStatus || '—'} colorClass={VERIFICATION_COLORS[data.assessment.verificationStatus] || ''} />
            <TimestampField label="Date" date={data.assessment.rapidAssessmentDate} />
          </div>
        </>
      )}
    </div>
  );
}

function CommitmentDetail({ data }: { data: any }) {
  const symbol = useCurrencySymbol();

  if (!data) return <DetailError message="No commitment data available" />;

  const items = data.items;

  return (
    <div className="space-y-5">
      <SectionLabel>Commitment Overview</SectionLabel>
      <div className="bg-muted/30 rounded-lg p-4 space-y-1">
        <BadgeField label="Status" value={data.status || 'PLANNED'} colorClass={COMMITMENT_COLORS[data.status] || ''} />
        <BadgeField label="Type" value={data.type || 'LOGISTICS'} />
        <FieldRow label="Donor" value={data.donor?.name || '—'} icon={DollarSign} />
        <FieldRow label="Entity" value={data.entity?.name || '—'} icon={MapPin} />
        <FieldRow label="Location" value={data.entity?.location || '—'} icon={MapPin} />
        <FieldRow label="Total Committed" value={String(data.totalCommittedQuantity ?? '—')} icon={Package} />
        <FieldRow label="Delivered" value={String(data.deliveredQuantity ?? 0)} icon={Truck} />
        <FieldRow label="Verified Delivered" value={String(data.verifiedDeliveredQuantity ?? 0)} icon={CheckCircle} />
        {data.totalValueEstimated != null && (
          <FieldRow label="Est. Value" value={`${symbol}${Number(data.totalValueEstimated).toLocaleString()}`} icon={DollarSign} />
        )}
        <TimestampField label="Commitment Date" date={data.commitmentDate} />
        <TimestampField label="Last Updated" date={data.lastUpdated} />
      </div>

      {data.notes && (
        <>
          <Separator />
          <SectionLabel>Notes</SectionLabel>
          <p className="text-sm text-foreground bg-muted/30 p-3 rounded-md">{data.notes}</p>
        </>
      )}

      {items && (Array.isArray(items) ? items.length > 0 : typeof items === 'object') && (
        <>
          <Separator />
          <SectionLabel>Committed Items</SectionLabel>
          {Array.isArray(items) ? (
            <ItemsTable items={items} />
          ) : (
            <JsonKeyValue data={items as Record<string, unknown>} />
          )}
        </>
      )}

      {data.incident && (
        <>
          <Separator />
          <SectionLabel>Incident</SectionLabel>
          <div className="bg-muted/30 rounded-lg p-4 space-y-1">
            <FieldRow label="Type" value={data.incident.type || '—'} icon={AlertTriangle} />
            {data.incident.subType && <FieldRow label="Sub-type" value={data.incident.subType} />}
            <BadgeField label="Severity" value={data.incident.severity || '—'} />
            <FieldRow label="Location" value={data.incident.location || '—'} icon={MapPin} />
          </div>
        </>
      )}
    </div>
  );
}

function EntitySignalFallback({ signal }: { signal: ActionSignalItem }) {
  const ctx = signal.context || {};
  const assignmentReasons: SignalReason[] = ['entity-needs-responder', 'entity-needs-donor'];
  const isAssignment = assignmentReasons.includes(signal.signalReason);

  return (
    <div className="space-y-5">
      <SectionLabel>Signal Overview</SectionLabel>
      <div className="bg-muted/30 rounded-lg p-4 space-y-1">
        <BadgeField label="Priority" value={signal.priority || 'MEDIUM'} />
        <FieldRow label="Entity" value={signal.entity?.name || '—'} icon={MapPin} />
        {signal.entity?.type && <FieldRow label="Type" value={signal.entity.type} />}
        {signal.entity?.location && <FieldRow label="Location" value={signal.entity.location} icon={MapPin} />}
        <TimestampField label="Signal Created" date={signal.createdAt} />
      </div>

      {signal.incident && (
        <>
          <Separator />
          <SectionLabel>Incident</SectionLabel>
          <div className="bg-muted/30 rounded-lg p-4 space-y-1">
            <FieldRow label="Name" value={signal.incident.name || '—'} icon={AlertTriangle} />
            {signal.incident.severity && <BadgeField label="Severity" value={signal.incident.severity} />}
          </div>
        </>
      )}

      {isAssignment && (
        <>
          <Separator />
          <SectionLabel>Assignment Info</SectionLabel>
          <div className="bg-muted/30 rounded-lg p-4">
            <p className="text-sm text-muted-foreground">
              {signal.signalReason === 'entity-needs-responder'
                ? 'This entity has been assessed and needs a responder assigned to create response plans for the active incident.'
                : 'This entity has been assessed and needs a donor assigned to provide commitments for the active incident.'}
            </p>
          </div>
        </>
      )}

      {Object.keys(ctx).length > 0 && (
        <>
          <Separator />
          <SectionLabel>Context</SectionLabel>
          <JsonKeyValue data={ctx as Record<string, unknown>} />
        </>
      )}
    </div>
  );
}
