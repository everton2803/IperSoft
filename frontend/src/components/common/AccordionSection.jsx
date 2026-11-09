import React, { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

export const AccordionSection = ({
  title,
  subtitle,
  icon: Icon,
  badge,
  headerRight,
  defaultOpen = true,
  storageKey,
  children,
  className = '',
  style = {}
}) => {
  const [isOpen, setIsOpen] = useState(() => {
    if (storageKey) {
      const saved = localStorage.getItem(`ipersoft_accordion_${storageKey}`);
      if (saved !== null) {
        return saved === 'true';
      }
    }
    return defaultOpen;
  });

  const handleToggle = () => {
    const nextState = !isOpen;
    setIsOpen(nextState);
    if (storageKey) {
      localStorage.setItem(`ipersoft_accordion_${storageKey}`, String(nextState));
    }
  };

  return (
    <div
      className={`accordion-section-wrapper ${className}`}
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '10px',
        overflow: 'hidden',
        transition: 'border-color 0.2s ease',
        ...style
      }}
    >
      {/* Header clicável para abrir/fechar */}
      <div
        className="accordion-header"
        onClick={handleToggle}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          cursor: 'pointer',
          userSelect: 'none',
          backgroundColor: isOpen ? 'transparent' : 'var(--bg-card)',
          transition: 'background-color 0.15s ease'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {Icon && (
            <div
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '8px',
                background: 'var(--color-primary-subtle)',
                border: '1px solid var(--color-primary-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-primary)',
                flexShrink: 0
              }}
            >
              <Icon size={16} />
            </div>
          )}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)' }}>
                {title}
              </span>
              {badge}
            </div>
            {subtitle && (
              <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', display: 'block', marginTop: '1px' }}>
                {subtitle}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }} onClick={(e) => e.stopPropagation()}>
          {headerRight}
          <button
            type="button"
            onClick={handleToggle}
            className="btn-icon"
            style={{
              width: '28px',
              height: '28px',
              padding: 0,
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            aria-label={isOpen ? 'Recolher seção' : 'Expandir seção'}
          >
            <ChevronDown
              size={16}
              style={{
                transition: 'transform 0.2s ease',
                transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)'
              }}
            />
          </button>
        </div>
      </div>

      {/* Conteúdo Expansível */}
      {isOpen && (
        <div
          className="accordion-content"
          style={{
            padding: '14px 16px',
            borderTop: '1px solid var(--border-subtle)',
            animation: 'fadeIn 0.2s ease'
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
};
