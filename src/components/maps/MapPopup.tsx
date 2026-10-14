'use client';

import React from 'react';
import { Popup } from 'react-map-gl/maplibre';

export interface MapPopupProps {
  longitude: number;
  latitude: number;
  onClose?: () => void;
  children: React.ReactNode;
  maxWidth?: string;
  offset?: number;
  closeButton?: boolean;
}

export function MapPopup({
  children,
  maxWidth = '280px',
  offset = 12,
  closeButton = false,
  onClose,
  longitude,
  latitude,
}: MapPopupProps) {
  return (
    <Popup
      longitude={longitude}
      latitude={latitude}
      onClose={onClose}
      closeButton={closeButton}
      closeOnClick
      offset={offset}
      maxWidth={maxWidth}
      className="dms-map-popup"
    >
      <div className="rounded-lg bg-white p-3 text-sm text-gray-900 shadow-lg">{children}</div>
    </Popup>
  );
}
