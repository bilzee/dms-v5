'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, AlertTriangle, AlertCircle, Info } from '@/lib/icons';
import { getBadgeClasses, getDotColor } from '@/components/shared/StatusBadge';

interface GapIndicatorProps {
  hasGap: boolean;
  severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  field?: string;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

const severityConfig = {
  CRITICAL: {
    label: 'Critical Gap',
    description: 'Immediate attention required',
    icon: AlertTriangle,
    animation: 'animate-pulse'
  },
  HIGH: {
    label: 'High Priority Gap',
    description: 'Urgent attention needed',
    icon: AlertCircle,
    animation: 'animate-pulse'
  },
  MEDIUM: {
    label: 'Medium Gap',
    description: 'Attention needed',
    icon: Info,
    animation: ''
  },
  LOW: {
    label: 'Low Gap',
    description: 'Monitor and address',
    icon: Info,
    animation: ''
  }
} as const;

// Size configuration
const sizeConfig = {
  sm: {
    dot: 'w-2 h-2',
    badge: 'text-xs px-1.5 py-0.5',
    text: 'text-xs',
    icon: 'w-3 h-3'
  },
  md: {
    dot: 'w-3 h-3',
    badge: 'text-sm px-2 py-1',
    text: 'text-sm',
    icon: 'w-4 h-4'
  },
  lg: {
    dot: 'w-4 h-4',
    badge: 'text-base px-3 py-1.5',
    text: 'text-base',
    icon: 'w-5 h-5'
  }
} as const;

/**
 * GapIndicator Component
 * 
 * Visual indicator for assessment gaps with color-coded severity levels
 * - Red for critical gaps
 * - Orange for high priority gaps  
 * - Yellow for medium gaps
 * - Green for no gaps
 * - Blue for low priority gaps
 */
export function GapIndicator({
  hasGap,
  severity = 'LOW',
  field,
  size = 'md',
  showLabel = false,
  className
}: GapIndicatorProps) {
  const sizeClasses = sizeConfig[size];
  
  const IconComponent = hasGap ? severityConfig[severity].icon : CheckCircle;

  const badgeClasses = getBadgeClasses('severity', severity);

  if (!hasGap) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <div className={cn(
          "rounded-full border-2 border-green-300 shadow-sm",
          getDotColor('severity', 'LOW'),
          sizeClasses.dot
        )} aria-hidden="true" />
        <IconComponent className={cn(
          "text-green-600 flex-shrink-0",
          sizeClasses.icon
        )} />
        {showLabel && (
          <span className={cn("text-green-800 font-semibold", sizeClasses.text)}>
            No Gap
          </span>
        )}
      </div>
    );
  }

  const config = severityConfig[severity];

  const severityTextColors: Record<string, string> = {
    CRITICAL: 'text-red-800',
    HIGH: 'text-orange-800',
    MEDIUM: 'text-yellow-800',
    LOW: 'text-green-800'
  };
  const textColor = severityTextColors[severity] || 'text-gray-800';

  return (
    <div className={cn(
      "flex items-center gap-2",
      config.animation && "gap-2",
      className
    )}>
      <IconComponent className={cn(
        "flex-shrink-0",
        textColor,
        sizeClasses.icon,
        config.animation && config.animation
      )} />
      
      {showLabel && (
        <div className="flex flex-col">
          <span className={cn("font-semibold", textColor, sizeClasses.text)}>
            {config.label}
          </span>
          {field && (
            <span className={cn("text-xs text-gray-500")}>
              {field}
            </span>
          )}
        </div>
      )}
      
      {!showLabel && severity !== 'LOW' && (
        <Badge 
          variant="outline" 
          className={cn(
            sizeClasses.badge,
            badgeClasses,
            "font-semibold shadow-sm"
          )}
        >
          {severity}
        </Badge>
      )}
    </div>
  );
}

export default GapIndicator;