import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getSignedPhotoUrl } from './photoUtils';

/**
 * Extracts 1-2 letter initials from a student name.
 */
function getInitials(name) {
  if (!name || typeof name !== 'string') return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * PhotoAvatar Component
 * Displays a student photo thumbnail, shimmer loading state, or initials fallback.
 */
export const PhotoAvatar = React.memo(function PhotoAvatar({
  student,
  size,
  onClick,
  supabase
}) {
  const [photoUrl, setPhotoUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [retried, setRetried] = useState(false);

  const photoPath = student?.photo_path;
  const photoVersion = student?.photo_updated_at;

  // Resolve responsive size if not provided
  const avatarSize = size || (typeof window !== 'undefined' && window.innerWidth <= 768 ? 48 : 56);

  useEffect(() => {
    let active = true;

    if (!photoPath) {
      setPhotoUrl(null);
      setLoading(false);
      setHasError(false);
      setRetried(false);
      return;
    }

    setLoading(true);
    setHasError(false);
    setRetried(false);

    getSignedPhotoUrl(supabase, photoPath, photoVersion)
      .then(url => {
        if (!active) return;
        if (url) {
          setPhotoUrl(url);
          setLoading(false);
        } else {
          setHasError(true);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!active) return;
        setHasError(true);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [photoPath, photoVersion, supabase]);

  const handleImageError = useCallback(() => {
    if (!retried && photoPath) {
      // Retry once by requesting a fresh signed URL (bypass cache)
      setRetried(true);
      getSignedPhotoUrl(supabase, photoPath, photoVersion, { bypassCache: true })
        .then(freshUrl => {
          if (freshUrl) {
            setPhotoUrl(freshUrl);
          } else {
            setHasError(true);
          }
        })
        .catch(() => {
          setHasError(true);
        });
    } else {
      setHasError(true);
    }
  }, [retried, photoPath, photoVersion, supabase]);

  const containerStyle = {
    width: avatarSize,
    height: avatarSize,
    minWidth: avatarSize,
    minHeight: avatarSize,
    borderRadius: '14px',
    border: '1px solid rgba(244, 196, 48, 0.35)',
    boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3)',
    background: 'rgba(20, 18, 35, 0.85)',
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: onClick ? 'pointer' : 'default',
    flexShrink: 0,
    boxSizing: 'border-box'
  };

  // 1. Shimmer Skeleton while loading signed URL
  if (loading) {
    return (
      <div style={containerStyle} onClick={onClick} title="Loading student photo...">
        <div style={{
          width: '100%',
          height: '100%',
          background: 'linear-gradient(90deg, rgba(244,196,48,0.05) 0%, rgba(244,196,48,0.18) 50%, rgba(244,196,48,0.05) 100%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 1.5s infinite linear'
        }} />
      </div>
    );
  }

  // 2. Photo successfully loaded
  if (photoUrl && !hasError) {
    return (
      <div style={containerStyle} onClick={onClick} title={onClick ? `View photo of ${student?.name}` : undefined}>
        <img
          src={photoUrl}
          alt={student?.name || 'Student photo'}
          width={avatarSize}
          height={avatarSize}
          loading="lazy"
          decoding="async"
          onError={handleImageError}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            borderRadius: '13px',
            display: 'block'
          }}
        />
      </div>
    );
  }

  // 3. Fallback: Initials Placeholder with "NO PHOTO" label
  const initials = getInitials(student?.name);
  return (
    <div style={containerStyle} onClick={onClick} title={onClick ? `No photo for ${student?.name}. Click to manage.` : 'No photo uploaded'}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        padding: '2px',
        userSelect: 'none'
      }}>
        <span style={{
          color: '#f4c430',
          fontSize: avatarSize <= 48 ? '13px' : '15px',
          fontWeight: 800,
          letterSpacing: '0.05em',
          lineHeight: 1
        }}>
          {initials}
        </span>
        <span style={{
          color: 'rgba(255, 255, 255, 0.4)',
          fontSize: avatarSize <= 48 ? '7px' : '8px',
          fontWeight: 700,
          letterSpacing: '0.08em',
          marginTop: '3px',
          textTransform: 'uppercase'
        }}>
          NO PHOTO
        </span>
      </div>
    </div>
  );
});

/**
 * PhotoLightbox Component
 * Full-resolution modal viewer for face matching and admin photo management.
 */
export function PhotoLightbox({
  student,
  onClose,
  canReplace = false,
  onReplace,
  canDelete = false,
  onDelete,
  supabase
}) {
  const [fullUrl, setFullUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const closeBtnRef = useRef(null);

  // Focus close button on open (lightweight focus trap)
  useEffect(() => {
    closeBtnRef.current?.focus();
  }, []);

  // Lock body scroll while lightbox is open
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Load high-resolution signed URL
  useEffect(() => {
    let active = true;
    if (!student?.photo_path) {
      setLoading(false);
      setLoadError(true);
      return;
    }

    setLoading(true);
    setLoadError(false);

    getSignedPhotoUrl(supabase, student.photo_path, student.photo_updated_at)
      .then(url => {
        if (!active) return;
        if (url) {
          setFullUrl(url);
          setLoading(false);
        } else {
          setLoadError(true);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!active) return;
        setLoadError(true);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [student?.photo_path, student?.photo_updated_at, supabase]);

  if (!student) return null;

  const isPaid = student.payment_status === 'Paid';

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(4, 3, 10, 0.88)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        animation: 'fadeIn 0.25s ease'
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          maxWidth: 'min(90vw, 480px)',
          width: '100%',
          background: 'rgba(12, 10, 24, 0.98)',
          border: '1px solid rgba(244, 196, 48, 0.35)',
          borderRadius: '28px',
          padding: '32px 24px',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.8), 0 0 40px rgba(244, 196, 48, 0.1)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          boxSizing: 'border-box'
        }}
      >
        {/* Close Button (X) */}
        <button
          ref={closeBtnRef}
          onClick={onClose}
          aria-label="Close photo preview"
          style={{
            position: 'absolute',
            top: '18px',
            right: '18px',
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            background: 'rgba(255, 255, 255, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#f1f0f8',
            fontSize: '18px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
            transition: 'all 0.2s ease'
          }}
        >
          ✕
        </button>

        {/* Modal Header Badge */}
        <div style={{
          fontSize: '11px',
          color: '#f4c430',
          fontWeight: 900,
          letterSpacing: '0.25em',
          textTransform: 'uppercase',
          marginBottom: '18px'
        }}>
          FACE VERIFICATION
        </div>

        {/* Photo Display Area */}
        <div style={{
          width: 'min(75vw, 280px)',
          height: 'min(75vw, 280px)',
          borderRadius: '22px',
          border: '2px solid rgba(244, 196, 48, 0.4)',
          background: 'rgba(0, 0, 0, 0.4)',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          marginBottom: '20px',
          boxShadow: '0 8px 30px rgba(0, 0, 0, 0.6)'
        }}>
          {loading && (
            <div style={{
              width: '100%',
              height: '100%',
              background: 'linear-gradient(90deg, rgba(244,196,48,0.05) 0%, rgba(244,196,48,0.18) 50%, rgba(244,196,48,0.05) 100%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 1.5s infinite linear'
            }} />
          )}

          {!loading && fullUrl && !loadError && (
            <img
              src={fullUrl}
              alt={student.name}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover'
              }}
            />
          )}

          {(!loading && (!fullUrl || loadError)) && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(255, 255, 255, 0.35)'
            }}>
              <span style={{ fontSize: '42px', fontWeight: 800, color: '#f4c430' }}>
                {getInitials(student.name)}
              </span>
              <span style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.2em', marginTop: '10px' }}>
                NO PHOTO RECORD
              </span>
            </div>
          )}
        </div>

        {/* Student Name */}
        <h3 style={{
          fontSize: '22px',
          fontWeight: 800,
          color: '#f1f0f8',
          textTransform: 'uppercase',
          marginBottom: '6px',
          wordBreak: 'break-word',
          letterSpacing: '0.02em'
        }}>
          {student.name}
        </h3>

        {/* Identifiers & Program Details */}
        <div style={{
          fontSize: '14px',
          color: '#a19ebf',
          fontWeight: 600,
          marginBottom: '14px'
        }}>
          {(student.roll_no || student.stud_id || 'NO ID')} • {student.program} {student.year}yr {student.section && `Sec ${student.section}`}
        </div>

        {/* Payment & Verification Status Badges */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '22px', flexWrap: 'wrap', justifyContent: 'center' }}>
          <span style={{
            fontSize: '11px',
            padding: '4px 12px',
            borderRadius: '8px',
            fontWeight: 900,
            letterSpacing: '0.08em',
            background: isPaid ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 77, 77, 0.15)',
            color: isPaid ? '#10b981' : '#ff4d4d',
            border: `1px solid ${isPaid ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255, 77, 77, 0.3)'}`
          }}>
            {isPaid ? 'PAID GUEST' : 'UNPAID'}
          </span>

          {student.is_verified && (
            <span style={{
              fontSize: '11px',
              padding: '4px 12px',
              borderRadius: '8px',
              fontWeight: 900,
              background: 'rgba(244, 196, 48, 0.15)',
              color: '#f4c430',
              border: '1px solid rgba(244, 196, 48, 0.3)'
            }}>
              ✦ GATE CLEARED
            </span>
          )}
        </div>

        {/* Master Admin Management Actions */}
        {(canReplace || canDelete) && (
          <div style={{
            display: 'flex',
            gap: '10px',
            width: '100%',
            marginTop: '8px',
            justifyContent: 'center'
          }}>
            {canReplace && (
              <button
                onClick={() => {
                  onClose();
                  onReplace?.(student);
                }}
                className="shine-btn"
                style={{
                  padding: '12px 20px',
                  fontSize: '12px',
                  borderRadius: '14px',
                  flex: 1
                }}
              >
                {student.photo_path ? 'REPLACE PHOTO' : 'UPLOAD PHOTO'}
              </button>
            )}

            {canDelete && student.photo_path && (
              <button
                onClick={() => {
                  if (confirm(`Remove photo for ${student.name}?`)) {
                    onDelete?.(student);
                    onClose();
                  }
                }}
                style={{
                  padding: '12px 18px',
                  fontSize: '12px',
                  borderRadius: '14px',
                  background: 'rgba(255, 77, 77, 0.15)',
                  border: '1px solid rgba(255, 77, 77, 0.35)',
                  color: '#ff4d4d',
                  fontWeight: 800,
                  cursor: 'pointer'
                }}
              >
                DELETE
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
