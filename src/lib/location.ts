export type LocationCoordinates = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

export type LocationDurationMinutes = 30 | 60;
export const LOCATION_DURATION_STORAGE_KEY = 'duet-location-share-duration';

export function parseLocationDuration(value: unknown): LocationDurationMinutes {
  return value === 30 || value === '30' ? 30 : 60;
}

export function readLocationDurationPreference(): LocationDurationMinutes {
  if (typeof window === 'undefined') return 60;
  try { return parseLocationDuration(window.localStorage.getItem(LOCATION_DURATION_STORAGE_KEY)); }
  catch { return 60; }
}

export function saveLocationDurationPreference(value: LocationDurationMinutes): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(LOCATION_DURATION_STORAGE_KEY, String(value)); }
  catch { /* Sharing still works with the default duration if storage is unavailable. */ }
}

export type LocationShare = {
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy_m: number;
  expires_at: string;
  updated_at: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function isValidLocation(latitude: number, longitude: number, accuracy: number): boolean {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 100000;
}

export function appleMapsUrl(latitude: number, longitude: number): string {
  return `https://maps.apple.com/?ll=${latitude},${longitude}`;
}

export function formatRemainingTime(milliseconds: number): string {
  const totalSeconds = Math.ceil(Math.max(0, Number.isFinite(milliseconds) ? milliseconds : 0) / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const paddedSeconds = String(seconds).padStart(2, '0');
  const paddedMinutes = String(minutes).padStart(2, '0');
  return hours > 0 ? `${hours}:${paddedMinutes}:${paddedSeconds}` : `${totalMinutes}:${paddedSeconds}`;
}

export function isExpired(expiresAt: string, now = Date.now()): boolean {
  const expiry = Date.parse(expiresAt);
  return !Number.isFinite(expiry) || expiry <= now;
}

export function visibleLocationShares(shares: LocationShare[], now = Date.now()): LocationShare[] {
  return shares.filter(share => !isExpired(share.expires_at, now));
}

export function canStopLocationShare(share: LocationShare | undefined, outcomeUnknown: boolean, now = Date.now()): boolean {
  return outcomeUnknown || Boolean(share && !isExpired(share.expires_at, now));
}

export function shouldApplyLocationList(
  requestId: number,
  latestRequestId: number,
  requestRevision: number,
  currentRevision: number,
): boolean {
  return requestId === latestRequestId && requestRevision === currentRevision;
}

export function locationShareFromCoordinates(
  userId: string,
  coordinates: LocationCoordinates,
  expiresAt: string,
  updatedAt = new Date().toISOString(),
): LocationShare {
  if (!userId || !isValidLocation(coordinates.latitude, coordinates.longitude, coordinates.accuracy)
    || !validTimestamp(expiresAt) || !validTimestamp(updatedAt)) {
    throw new Error('invalid_location_share');
  }
  return {
    user_id: userId,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    accuracy_m: coordinates.accuracy,
    expires_at: expiresAt,
    updated_at: updatedAt,
  };
}

export function upsertLocationShare(shares: LocationShare[], next: LocationShare): LocationShare[] {
  return [...shares.filter(share => share.user_id !== next.user_id), next];
}

export function removeLocationShare(shares: LocationShare[], userId: string): LocationShare[] {
  return shares.filter(share => share.user_id !== userId);
}

export function removeLocationShareSession(shares: LocationShare[], userId: string, expiresAt: string): LocationShare[] {
  return shares.filter(share => share.user_id !== userId || share.expires_at !== expiresAt);
}

export function parseLocationSharesResponse(value: unknown): LocationShare[] {
  if (!isRecord(value) || !Array.isArray(value.data)) throw new Error('invalid_location_response');
  return value.data.map((item): LocationShare => {
    if (!isRecord(item)
      || typeof item.user_id !== 'string' || item.user_id.length === 0
      || typeof item.latitude !== 'number' || typeof item.longitude !== 'number'
      || typeof item.accuracy_m !== 'number'
      || !isValidLocation(item.latitude, item.longitude, item.accuracy_m)
      || !validTimestamp(item.expires_at) || !validTimestamp(item.updated_at)) {
      throw new Error('invalid_location_response');
    }
    return {
      user_id: item.user_id,
      latitude: item.latitude,
      longitude: item.longitude,
      accuracy_m: item.accuracy_m,
      expires_at: item.expires_at,
      updated_at: item.updated_at,
    };
  });
}

export function parseLocationStartResponse(value: unknown): { expires_at: string } {
  if (!isRecord(value) || !isRecord(value.data)
    || Object.keys(value.data).length !== 1
    || !validTimestamp(value.data.expires_at)) {
    throw new Error('invalid_location_start_response');
  }
  return { expires_at: value.data.expires_at };
}
