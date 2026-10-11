import React, { useState } from 'react';
import { User, Lock, Eye, EyeOff, ArrowRight, AlertCircle, Loader2 } from 'lucide-react';
import { authService } from '../services/api';

export const LoginForm = ({ onAuthSuccess }) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    if (!identifier.trim() || !password) {
      setErrorMessage('Informe seu usuário ou e-mail e sua senha.');
      return;
    }

    setIsLoading(true);
    try {
      const data = await authService.login(identifier.trim(), password);
      onAuthSuccess(data.user);
    } catch (err) {
      setErrorMessage(err.message || 'Credenciais inválidas.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-card" id="login-card">
      <div className="login-header">
        <h1 className="login-title">Acesso ao Sistema</h1>
        <p className="login-subtitle">Entre com suas credenciais para acessar o painel</p>
      </div>

      {errorMessage && (
        <div className="alert-box alert-error" id="login-error-alert" role="alert">
          <AlertCircle size={16} />
          <span>{errorMessage}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="login-form" id="login-form">
        <div className="form-group">
          <label htmlFor="login-username" className="form-label">
            Usuário ou E-mail
          </label>
          <div className="input-wrapper">
            <User className="input-icon" size={17} />
            <input
              id="login-username"
              type="text"
              className="form-input"
              placeholder="ex: admin ou usuario@empresa.com"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
              autoFocus
              disabled={isLoading}
              required
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="login-password" className="form-label">
            Senha
          </label>
          <div className="input-wrapper">
            <Lock className="input-icon" size={17} />
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              className="form-input"
              placeholder="Digite sua senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={isLoading}
              required
            />
            <button
              type="button"
              id="toggle-password-btn"
              className="input-action-btn"
              onClick={() => setShowPassword(!showPassword)}
              title={showPassword ? 'Ocultar' : 'Exibir'}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          id="login-submit-btn"
          className="btn-primary"
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <Loader2 size={16} className="spin-icon" />
              <span>Autenticando...</span>
            </>
          ) : (
            <>
              <span>Entrar</span>
              <ArrowRight size={16} />
            </>
          )}
        </button>
      </form>
    </div>
  );
};
