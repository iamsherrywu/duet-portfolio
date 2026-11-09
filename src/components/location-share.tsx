'use client';
import {LoadingStatus,StatusText} from './loading-status';

import { useCallback, useEffect, useRef, useState } from 'react';
import { canStopLocationShare, formatRemainingTime, isExpired, isValidLocation, locationShareFromCoordinates, parseLocationSharesResponse, parseLocationStartResponse, readLocationDurationPreference, removeLocationShareSession, saveLocationDurationPreference, shouldApplyLocationList, upsertLocationShare, visibleLocationShares, type LocationCoordinates, type LocationDurationMinutes, type LocationShare } from '../lib/location';
import { browserClient, subscribeToCouple } from '../lib/supabase/browser';

type ApiErrorPayload = { error?: { code?: string; message?: string } };
type LocationRefresh = { shares: LocationShare[]; applied: boolean };
type LoadState = 'loading' | 'ready' | 'unauthenticated' | 'unpaired' | 'error';

class LocationApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, { ...init, cache: 'no-store' });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(payload) && isRecord(payload.error) ? payload.error as ApiErrorPayload['error'] : undefined;
    throw new LocationApiError(error?.code ?? 'request_failed', error?.message ?? 'Request failed. Try again later.');
  }
  return payload;
}

function positionError(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) return 'Allow location access in your browser, then retry.';
  if (error.code === error.TIMEOUT) return 'Location timed out. Check your connection and location settings.';
  return 'Location unavailable. Try again later.';
}

function messageForError(error: unknown): string {
  if (error instanceof LocationApiError) {
    if (error.code === 'unauthenticated') return 'Sign in to share your location.';
    if (error.code === 'not_paired') return 'Invite your partner to the space first.';
    if (error.code === 'space_inactive') return 'Your space is unavailable.';
    if (error.code === 'location_expired' || error.code === 'location_not_active') return 'Location sharing ended. Start again to share.';
    if (error.code === 'location_rate_limited') return 'Too many location updates. Try again later.';
    if (error.code === 'already_sharing') return 'You are already sharing your location.';
    return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Check your connection and try again.';
}

function readCurrentPosition(): Promise<LocationCoordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser does not support location.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      position => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      }),
      error => reject(new Error(positionError(error))),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  });
}

function timestamp(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(value));
}

export function LocationShare({onChanged}:{onChanged?:()=>void}={}) {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [shares, setShares] = useState<LocationShare[]>([]);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [durationMinutes,setDurationMinutes]=useState<LocationDurationMinutes>(60);
  const [notice, setNotice] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [shareOutcomeUnknown, setShareOutcomeUnknown] = useState(false);
  const userIdRef = useRef<string | null>(null);
  const coupleIdRef = useRef<string | null>(null);
  const expiryRef = useRef<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastUploadAtRef = useRef(0);
  const expiryHandledRef = useRef(false);
  const refreshRef = useRef<() => Promise<LocationRefresh>>(async () => ({ shares: [], applied: false }));
  const locationRevisionRef = useRef(0);
  const listRequestIdRef = useRef(0);

  useEffect(()=>{setDurationMinutes(readLocationDurationPreference());},[]);

  const stopWatching = useCallback(() => {
    if (watchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;
  }, []);

  const startWatching = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation
      || document.visibilityState !== 'visible' || watchIdRef.current !== null) return;
    const expiry = expiryRef.current;
    if (!expiry || isExpired(expiry)) return;

    watchIdRef.current = navigator.geolocation.watchPosition(position => {
      if (document.visibilityState !== 'visible' || !expiryRef.current || isExpired(expiryRef.current)) return;
      const coordinates: LocationCoordinates = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
      if (!isValidLocation(coordinates.latitude, coordinates.longitude, coordinates.accuracy)) {
        setErrorMessage('Invalid location or accuracy. Nothing was uploaded.');
        return;
      }
      const currentTime = Date.now();
      if (currentTime - lastUploadAtRef.current < 20000) return;
      lastUploadAtRef.current = currentTime;
      void requestJson('/api/duet/location', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(coordinates),
      }).then(() => refreshRef.current()).then(() => {
        setErrorMessage('');
      }).catch(async requestError => {
        setErrorMessage(messageForError(requestError));
        if (requestError instanceof LocationApiError
          && ['location_expired', 'location_not_active'].includes(requestError.code)) {
          stopWatching();
          try { await refreshRef.current(); } catch { /* Keep the last timestamp visible if the network is down. */ }
        }
      });
    }, positionFailure => {
      setErrorMessage(positionError(positionFailure));
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
  }, [stopWatching]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    const refreshShares = async (): Promise<LocationRefresh> => {
      const requestId = ++listRequestIdRef.current;
      const requestRevision = locationRevisionRef.current;
      const payload = await requestJson('/api/duet/location');
      const nextShares = parseLocationSharesResponse(payload);
      const applied = !disposed && shouldApplyLocationList(
        requestId,
        listRequestIdRef.current,
        requestRevision,
        locationRevisionRef.current,
      );
      if (applied) {
        setShares(nextShares);
        const ownShare = nextShares.find(share => share.user_id === userIdRef.current);
        expiryRef.current = ownShare?.expires_at ?? null;
        if (ownShare) {
          const updatedAt = Date.parse(ownShare.updated_at);
          if (Number.isFinite(updatedAt)) lastUploadAtRef.current = Math.max(lastUploadAtRef.current, updatedAt);
        }
        if (!ownShare) expiryHandledRef.current = false;
      }
      return { shares: nextShares, applied };
    };
    refreshRef.current = refreshShares;

    const subscribe = () => {
      const coupleId = coupleIdRef.current;
      if (!coupleId || unsubscribe) return;
      unsubscribe = subscribeToCouple(coupleId, () => {
        if (document.visibilityState !== 'visible') return;
        void refreshShares().then(result => {
          if (!result.applied) return;
          const ownShare = result.shares.find(share => share.user_id === userIdRef.current);
          if (ownShare && !isExpired(ownShare.expires_at)) {
            expiryHandledRef.current = false;
            startWatching();
          } else {
            expiryRef.current = null;
            stopWatching();
          }
        }).catch(() => undefined);
      });
    };
    const handleVisibility = async () => {
      if (document.visibilityState === 'hidden') {
        stopWatching();
        unsubscribe?.();
        unsubscribe = null;
        return;
      }
      setNow(Date.now());
      if (!coupleIdRef.current) return;
      const locationRevision = locationRevisionRef.current;
      subscribe();
      try {
        const result = await refreshShares();
        if (!result.applied || locationRevision !== locationRevisionRef.current) return;
        const currentShares = result.shares;
        const ownShare = currentShares.find(share => share.user_id === userIdRef.current);
        if (ownShare && !isExpired(ownShare.expires_at)) {
          expiryHandledRef.current = false;
          startWatching();
        }
      } catch (refreshError) {
        setErrorMessage(messageForError(refreshError));
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    void (async () => {
      try {
        const { data: authData, error: authError } = await browserClient().auth.getUser();
        if (disposed) return;
        if (authError || !authData.user) {
          setLoadState('unauthenticated');
          return;
        }
        userIdRef.current = authData.user.id;
        const couplePayload = await requestJson('/api/duet/couple');
        if (disposed) return;
        const coupleData = isRecord(couplePayload) && isRecord(couplePayload.data) ? couplePayload.data : null;
        const coupleId = coupleData?.coupleId;
        if (typeof coupleId !== 'string' || !coupleId) {
          setLoadState('unpaired');
          return;
        }
        coupleIdRef.current = coupleId;
        subscribe();
        let result = await refreshShares();
        // Another Realtime/visibility read may have won the race; retry once so
        // initial load can still establish the current own-share session.
        if (!result.applied && !disposed) result = await refreshShares();
        if (disposed) return;
        setLoadState('ready');
        const ownShare = result.applied ? result.shares.find(share => share.user_id === userIdRef.current) : undefined;
        if (ownShare && !isExpired(ownShare.expires_at) && document.visibilityState === 'visible') startWatching();
      } catch (loadError) {
        if (disposed) return;
        if (loadError instanceof LocationApiError && loadError.code === 'not_paired') setLoadState('unpaired');
        else if (loadError instanceof LocationApiError && loadError.code === 'unauthenticated') setLoadState('unauthenticated');
        else {
          setLoadState('error');
          setErrorMessage(messageForError(loadError));
        }
      }
    })();

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      unsubscribe?.();
      stopWatching();
    };
  }, [startWatching, stopWatching]);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);
      const expiry = expiryRef.current;
      if (expiry && isExpired(expiry, currentTime) && !expiryHandledRef.current) {
        expiryHandledRef.current = true;
        stopWatching();
        setNotice('Location sharing expired.');
        void refreshRef.current().catch(() => undefined);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [stopWatching]);

  const startShare = async () => {
    setBusy(true);
    setNotice('');
    setErrorMessage('');
    try {
      if (!navigator.geolocation) throw new Error('This browser does not support location.');
      const coordinates = await readCurrentPosition();
      if (!isValidLocation(coordinates.latitude, coordinates.longitude, coordinates.accuracy)) {
        throw new Error('Invalid location or accuracy. Try again.');
      }
      let confirmedShare: LocationShare;
      try {
        const payload = await requestJson('/api/duet/location/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...coordinates, durationMinutes }),
        });
        const session = parseLocationStartResponse(payload);
        if (isExpired(session.expires_at)) throw new Error('Invalid sharing duration. Try again.');
        confirmedShare = locationShareFromCoordinates(userIdRef.current ?? '', coordinates, session.expires_at);
      } catch (startError) {
        // The POST may have reached the server even if its response was lost. Reconcile
        // before showing the start button again, so the user can still stop the session.
        try {
          const result = await refreshRef.current();
          if (!result.applied) throw new Error('location_state_not_confirmed');
          const currentShares = result.shares;
          const existing = currentShares.find(share => share.user_id === userIdRef.current);
          if (existing && !isExpired(existing.expires_at)) {
            expiryRef.current = existing.expires_at;
            expiryHandledRef.current = false;
            setShareOutcomeUnknown(false);
            lastUploadAtRef.current = Date.now();
            startWatching();
            setNotice('Location sharing is active. Updates pause in the background.');
            onChanged?.();
            setErrorMessage('Start was not acknowledged. Current sharing status was recovered from the server.');
            return;
          }
        } catch {
          // Do not offer a second start when the first request may have committed.
          setShareOutcomeUnknown(true);
          setErrorMessage('Sharing status is unknown. Try stopping to prevent further sharing.');
          return;
        }
        throw startError;
      }

      locationRevisionRef.current += 1;
      listRequestIdRef.current += 1;
      expiryRef.current = confirmedShare.expires_at;
      expiryHandledRef.current = false;
      setShareOutcomeUnknown(false);
      lastUploadAtRef.current = Date.now();
      setShares(current => upsertLocationShare(current, confirmedShare));
      onChanged?.();
      startWatching();
      setNotice(`Sharing for ${durationMinutes===30?'30 minutes':'1 hour'}. Updates pause in the background.`);
      try {
        const result = await refreshRef.current();
        // Keep the confirmed start manageable even if a read replica or transient
        // response does not yet include the new row.
        if (result.applied && !result.shares.some(share => share.user_id === userIdRef.current)) {
          setShares(current => upsertLocationShare(current, confirmedShare));
        }
      } catch {
        setErrorMessage('Sharing started, but status could not refresh. You can still stop sharing.');
      }
    } catch (startError) {
      setErrorMessage(messageForError(startError));
    } finally {
      setBusy(false);
    }
  };

  const stopShare = async () => {
    setBusy(true);
    stopWatching();
    setErrorMessage('');
    const stoppedExpiresAt = expiryRef.current;
    try {
      await requestJson('/api/duet/location', { method: 'DELETE' });
      locationRevisionRef.current += 1;
      listRequestIdRef.current += 1;
      expiryRef.current = null;
      expiryHandledRef.current = false;
      setShareOutcomeUnknown(false);
      const userId = userIdRef.current;
      if (userId && stoppedExpiresAt) {
        setShares(current => removeLocationShareSession(current, userId, stoppedExpiresAt));
      }
      setNotice('Sharing stopped. Your location was removed from the space.');
      onChanged?.();
      try {
        await refreshRef.current();
        // Keep the confirmed deletion local without hiding a newer session started in another tab.
        if (userId && stoppedExpiresAt) {
          setShares(current => removeLocationShareSession(current, userId, stoppedExpiresAt));
        }
      } catch {
        setErrorMessage('Sharing stopped. Your partner’s status could not refresh.');
      }
    } catch (stopError) {
      const stopErrorMessage = messageForError(stopError);
      try {
        const result = await refreshRef.current();
        if (!result.applied) throw new Error('location_state_not_confirmed');
        const currentShares = result.shares;
        const currentOwnShare = currentShares.find(share => share.user_id === userIdRef.current);
        if (!currentOwnShare) {
          locationRevisionRef.current += 1;
          listRequestIdRef.current += 1;
          expiryRef.current = null;
          expiryHandledRef.current = false;
          setShareOutcomeUnknown(false);
          setErrorMessage('');
          setNotice('The server confirmed no active location share.');
          onChanged?.();
          return;
        }
        expiryRef.current = currentOwnShare.expires_at;
        setShareOutcomeUnknown(false);
        setErrorMessage(`Stop not confirmed: ${stopErrorMessage} The server location expires within the selected duration, up to 1 hour.`);
      } catch {
        setErrorMessage(`Stop not confirmed: ${stopErrorMessage} The server location expires within the selected duration, up to 1 hour.`);
      }
    } finally {
      setBusy(false);
    }
  };

  const currentNow = Math.max(now, Date.now());
  const currentShares = visibleLocationShares(shares, currentNow);
  const ownShare = currentShares.find(share => share.user_id === userIdRef.current);
  const remaining = ownShare ? formatRemainingTime(Date.parse(ownShare.expires_at) - currentNow) : null;
  const canStop = canStopLocationShare(ownShare, shareOutcomeUnknown, currentNow);

  return <section className="duet-location-controls approved-c05-controls" aria-label="Location sharing controls">
    {loadState==='loading'&&<p role="status"><LoadingStatus/></p>}
    {loadState==='unauthenticated'&&<p role="status">Sign in to share your location.</p>}
    {loadState==='unpaired'&&<p role="status">Send an invitation to connect first.</p>}
    {loadState==='error'&&<p role="alert">{errorMessage||'Could not load location sharing.'}</p>}
    {loadState==='ready'&&<>
      <div className={`duet-location-state ${canStop?'is-sharing':''}`}>
        <i aria-hidden="true"/><div><strong>{ownShare?'Sharing location':shareOutcomeUnknown?'Status unconfirmed':'Not sharing'}</strong>
          <small>{ownShare?`${remaining??'…'} remaining · updated ${timestamp(ownShare.updated_at)}`:shareOutcomeUnknown?'Try stopping to end any active session.':'Only you can see your location until sharing starts.'}</small>
        </div>
      </div>
      <div className="approved-location-actions">
        {canStop&&<button className="duet-location-action is-stop" type="button" disabled={busy} onClick={()=>void stopShare()}>{busy?'Processing…':shareOutcomeUnknown?'Try stopping':'Stop sharing'}</button>}
        <div className="approved-location-settings">
          <label className="duet-location-duration">Share duration<select aria-label="Share duration" disabled={busy||canStop} value={durationMinutes} onChange={event=>{const next=Number(event.target.value) as LocationDurationMinutes;setDurationMinutes(next);saveLocationDurationPreference(next);}}><option value={30}>30 minutes</option><option value={60}>1 hour</option></select></label>
          <p className="approved-location-duration-note">You can stop sharing at any time.</p>
          {!canStop&&<button className="duet-location-action" type="button" disabled={busy} onClick={()=>void startShare()}>{busy?'Processing…':'in sync'}</button>}
        </div>
      </div>
    </>}

    {notice&&<p className="duet-chat-status" role="status">{notice}</p>}
    {errorMessage&&loadState==='ready'&&<p className="duet-location-error" role="alert">{errorMessage}</p>}
  </section>;
}
