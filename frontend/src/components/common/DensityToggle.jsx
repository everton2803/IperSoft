import React, { useState, useEffect } from 'react';
import { LayoutList, List } from 'lucide-react';

export const DensityToggle = ({
  density: propDensity,
  onChange,
  storageKey = 'table_density',
  className = '',
  style = {}
}) => {
  const [internalDensity, setInternalDensity] = useState(() => {
    if (storageKey) {
      const saved = localStorage.getItem(`ipersoft_density_${storageKey}`);
      if (saved === 'compact' || saved === 'comfortable') {
        return saved;
      }
    }
    return 'comfortable';
  });

  const isControlled = propDensity !== undefined;
  const currentDensity = isControlled ? propDensity : internalDensity;

  const handleSelect = (mode) => {
    if (!isControlled) {
      setInternalDensity(mode);
    }
    if (storageKey) {
      localStorage.setItem(`ipersoft_density_${storageKey}`, mode);
    }
    if (onChange) {
      onChange(mode);
    }
  };

  // Se inicializou com valor do localStorage e temos onChange, notifica na montagem se diferente
  useEffect(() => {
    if (!isControlled && onChange) {
      onChange(internalDensity);
    }
  }, []);

  return (
    <div
      className={`density-toggle-group ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: 'var(--bg-surface-elevated, #161b26)',
        border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
        borderRadius: '6px',
        padding: '2px',
        gap: '2px',
        ...style
      }}
      title="Densidade da Tabela"
    >
      <button
        type="button"
        onClick={() => handleSelect('comfortable')}
        className={`density-btn ${currentDensity === 'comfortable' ? 'active' : ''}`}
        style={{
          border: 'none',
          background: currentDensity === 'comfortable' ? 'var(--color-primary, #ff6b00)' : 'transparent',
          color: currentDensity === 'comfortable' ? '#fff' : 'var(--text-muted, #8b949e)',
          padding: '4px 7px',
          borderRadius: '4px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '0.74rem',
          fontWeight: 600,
          transition: 'all 0.15s ease'
        }}
        title="Modo Confortável (Espaçamento padrão)"
      >
        <LayoutList size={13} />
        <span className="density-label">Normal</span>
      </button>

      <button
        type="button"
        onClick={() => handleSelect('compact')}
        className={`density-btn ${currentDensity === 'compact' ? 'active' : ''}`}
        style={{
          border: 'none',
          background: currentDensity === 'compact' ? 'var(--color-primary, #ff6b00)' : 'transparent',
          color: currentDensity === 'compact' ? '#fff' : 'var(--text-muted, #8b949e)',
          padding: '4px 7px',
          borderRadius: '4px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '0.74rem',
          fontWeight: 600,
          transition: 'all 0.15s ease'
        }}
        title="Modo Compacto (Alta densidade para NOC / monitoramento)"
      >
        <List size={13} />
        <span className="density-label">Compacto</span>
      </button>
    </div>
  );
};
