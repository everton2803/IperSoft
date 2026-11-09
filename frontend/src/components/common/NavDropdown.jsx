import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

export const NavDropdown = ({
  label,
  icon: Icon,
  items = [],
  isActive = false,
  badgeCount = 0,
  badgeColor = '#e53935',
  isOpen,
  onToggle,
  onClose
}) => {
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        if (onClose) onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  return (
    <div className="nav-dropdown-wrapper" ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className={`nav-link-btn ${isActive ? 'active' : ''}`}
        onClick={onToggle}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          position: 'relative',
          cursor: 'pointer'
        }}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        {Icon && <Icon size={15} />}
        <span>{label}</span>
        {badgeCount > 0 && (
          <span
            style={{
              backgroundColor: badgeColor,
              color: '#fff',
              fontSize: '0.65rem',
              fontWeight: 800,
              borderRadius: '9999px',
              padding: '1px 6px',
              marginLeft: '2px',
              lineHeight: '1.2'
            }}
          >
            {badgeCount}
          </span>
        )}
        <ChevronDown
          size={13}
          style={{
            transition: 'transform 0.2s ease',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            opacity: 0.7
          }}
        />
      </button>

      {isOpen && (
        <div
          className="nav-dropdown-menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            minWidth: '280px',
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '10px',
            boxShadow: '0 12px 30px rgba(0, 0, 0, 0.25)',
            padding: '6px',
            zIndex: 100,
            animation: 'dropdownFadeIn 0.15s ease-out',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px'
          }}
        >
          {items.map((item, idx) => {
            if (item.divider) {
              return (
                <div
                  key={idx}
                  style={{
                    height: '1px',
                    backgroundColor: 'var(--border-subtle)',
                    margin: '4px 0'
                  }}
                />
              );
            }

            return (
              <button
                key={item.id || idx}
                type="button"
                className={`nav-dropdown-item ${item.active ? 'active-item' : ''}`}
                onClick={() => {
                  if (item.onClick) item.onClick();
                  if (onClose) onClose();
                }}
                disabled={item.disabled}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  width: '100%',
                  padding: '9px 12px',
                  backgroundColor: item.active ? 'var(--color-primary-subtle)' : 'transparent',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: item.disabled ? 'not-allowed' : 'pointer',
                  textAlign: 'left',
                  color: item.active ? 'var(--color-primary)' : 'var(--text-main)',
                  transition: 'background-color 0.15s ease, color 0.15s ease',
                  opacity: item.disabled ? 0.5 : 1
                }}
                onMouseEnter={(e) => {
                  if (!item.active && !item.disabled) {
                    e.currentTarget.style.backgroundColor = 'var(--bg-canvas)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!item.active) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
              >
                {item.icon && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '26px',
                      height: '26px',
                      borderRadius: '6px',
                      backgroundColor: item.active ? 'rgba(255, 152, 0, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                      color: item.active ? 'var(--color-primary)' : 'inherit',
                      flexShrink: 0
                    }}
                  >
                    {item.icon}
                  </div>
                )}
                <div style={{ flex: '1 1 auto', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                    <span style={{ fontSize: '0.86rem', fontWeight: item.active ? 700 : 500 }}>
                      {item.label}
                    </span>
                    {item.badge && (
                      <span
                        style={{
                          backgroundColor: item.badgeColor || '#e53935',
                          color: '#fff',
                          fontSize: '0.65rem',
                          fontWeight: 800,
                          borderRadius: '9999px',
                          padding: '1px 6px',
                          lineHeight: '1.2'
                        }}
                      >
                        {item.badge}
                      </span>
                    )}
                  </div>
                  {item.subtitle && (
                    <span
                      style={{
                        display: 'block',
                        fontSize: '0.72rem',
                        color: 'var(--text-secondary)',
                        marginTop: '1px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      {item.subtitle}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
