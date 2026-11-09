import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export const SlideOverDrawer = ({
  isOpen,
  onClose,
  title,
  subtitle,
  icon: Icon,
  children,
  footer,
  width = '500px'
}) => {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="drawer-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(3px)',
        zIndex: 1050,
        display: 'flex',
        justifyContent: 'flex-end',
        animation: 'backdropFadeIn 0.2s ease-out'
      }}
    >
      <div
        className="drawer-panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: width,
          height: '100%',
          backgroundColor: 'var(--bg-surface)',
          borderLeft: '1px solid var(--border-subtle)',
          boxShadow: '-8px 0 24px rgba(0, 0, 0, 0.3)',
          display: 'flex',
          flexDirection: 'column',
          animation: 'drawerSlideLeft 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      >
        {/* Header do Drawer */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            backgroundColor: 'var(--bg-card)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {Icon && (
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  background: 'var(--color-primary-subtle)',
                  border: '1px solid var(--color-primary-border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--color-primary)'
                }}
              >
                <Icon size={18} />
              </div>
            )}
            <div>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)' }}>
                {title}
              </h3>
              {subtitle && (
                <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', display: 'block', marginTop: '1px' }}>
                  {subtitle}
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            className="btn-icon"
            onClick={onClose}
            title="Fechar (Esc)"
            style={{ borderRadius: '8px' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Corpo com scroll */}
        <div
          style={{
            flex: '1 1 auto',
            overflowY: 'auto',
            padding: '1.5rem'
          }}
        >
          {children}
        </div>

        {/* Footer Opcional */}
        {footer && (
          <div
            style={{
              padding: '1rem 1.5rem',
              borderTop: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-card)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '8px'
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
