import React, { useState } from 'react';
import { 
  User, 
  Mail, 
  Lock, 
  Eye, 
  EyeOff, 
  ShieldCheck, 
  ArrowRight, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Sparkles,
  Server,
  Terminal,
  Activity
} from 'lucide-react';
import { authService } from '../services/api';

export const AuthCard = ({ onAuthSuccess }) => {
  const [activeTab, setActiveTab] = useState('login'); // 'login' | 'register'
  
  // Login form state
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Register form state
  const [regFullName, setRegFullName] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regRole, setRegRole] = useState('noc_operator');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);

  // Status and feedback
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Password strength calculation
  const getPasswordStrength = (pass) => {
    if (!pass) return { score: 0, label: 'Vazia', color: 'var(--text-muted)' };
    let score = 0;
    if (pass.length >= 6) score += 1;
    if (pass.length >= 10) score += 1;
    if (/[A-Z]/.test(pass)) score += 1;
    if (/[0-9]/.test(pass)) score += 1;
    if (/[^A-Za-z0-9]/.test(pass)) score += 1;

    if (score <= 1) return { score: 1, label: 'Fraca', color: 'var(--color-danger)' };
    if (score <= 3) return { score: 2, label: 'Média', color: 'var(--color-warning)' };
    if (score === 4) return { score: 3, label: 'Forte', color: 'var(--color-primary)' };
    return { score: 4, label: 'Excelente', color: 'var(--color-success)' };
  };

  const pwdStrength = getPasswordStrength(regPassword);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setErrorMessage('');
    setSuccessMessage('');
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!loginIdentifier.trim() || !loginPassword) {
      setErrorMessage('Por favor, informe seu usuário/e-mail e senha.');
      return;
    }

    setIsLoading(true);
    try {
      const data = await authService.login(loginIdentifier.trim(), loginPassword);
      setSuccessMessage(`Bem-vindo de volta, ${data.user.full_name || data.user.username}!`);
      setTimeout(() => {
        onAuthSuccess(data.user);
      }, 500);
    } catch (err) {
      setErrorMessage(err.message || 'Credenciais inválidas. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!regFullName.trim() || !regUsername.trim() || !regEmail.trim() || !regPassword) {
      setErrorMessage('Todos os campos obrigatórios devem ser preenchidos.');
      return;
    }

    if (regPassword.length < 6) {
      setErrorMessage('A senha precisa ter no mínimo 6 caracteres.');
      return;
    }

    if (regPassword !== regConfirmPassword) {
      setErrorMessage('A confirmação de senha não confere com a senha digitada.');
      return;
    }

    setIsLoading(true);
    try {
      const data = await authService.register({
        username: regUsername.trim(),
        email: regEmail.trim(),
        full_name: regFullName.trim(),
        password: regPassword,
        role: regRole,
      });

      setSuccessMessage('Conta de operador criada com sucesso! Redirecionando...');
      setTimeout(() => {
        onAuthSuccess(data.user);
      }, 700);
    } catch (err) {
      setErrorMessage(err.message || 'Erro ao realizar cadastro.');
    } finally {
      setIsLoading(false);
    }
  };

  // Demo helper to prefill sample credentials
  const fillDemoData = (type) => {
    setErrorMessage('');
    if (type === 'login') {
      setLoginIdentifier('admin.noc');
      setLoginPassword('NocPass2026!');
    } else {
      setRegFullName('Everton NOC Admin');
      setRegUsername('everton.noc');
      setRegEmail('everton@opersoft.local');
      setRegRole('admin');
      setRegPassword('NocPass2026!');
      setRegConfirmPassword('NocPass2026!');
    }
  };

  return (
    <div className="auth-card-container">
      {/* Background ambient badge */}
      <div className="auth-card-header">
        <div className="auth-badge-pill">
          <Terminal size={14} className="auth-badge-icon" />
          <span>PORTAL DE GESTÃO DE REDES</span>
        </div>
        <h1 className="auth-title">
          {activeTab === 'login' ? 'Acesso ao Sistema' : 'Cadastro de Operador'}
        </h1>
        <p className="auth-subtitle">
          {activeTab === 'login' 
            ? 'Autentique-se para gerenciar os ativos de rede, hosts e serviços integrados.' 
            : 'Registre seu usuário para obter acesso ao controle de ativos e topologias.'}
        </p>
      </div>

      {/* Tab Switcher */}
      <div className="auth-tabs" role="tablist">
        <button
          id="tab-login-btn"
          role="tab"
          aria-selected={activeTab === 'login'}
          className={`auth-tab ${activeTab === 'login' ? 'active' : ''}`}
          onClick={() => handleTabChange('login')}
        >
          <Lock size={16} />
          <span>Entrar no Sistema</span>
        </button>
        <button
          id="tab-register-btn"
          role="tab"
          aria-selected={activeTab === 'register'}
          className={`auth-tab ${activeTab === 'register' ? 'active' : ''}`}
          onClick={() => handleTabChange('register')}
        >
          <User size={16} />
          <span>Criar Nova Conta</span>
        </button>
      </div>

      {/* Notifications */}
      {errorMessage && (
        <div className="alert-message alert-error" id="auth-error-alert" role="alert">
          <AlertCircle size={18} className="alert-icon" />
          <span>{errorMessage}</span>
        </div>
      )}

      {successMessage && (
        <div className="alert-message alert-success" id="auth-success-alert" role="status">
          <CheckCircle2 size={18} className="alert-icon" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* LOGIN FORM */}
      {activeTab === 'login' && (
        <form onSubmit={handleLoginSubmit} className="auth-form" id="login-form">
          <div className="form-group">
            <label htmlFor="login-identifier" className="form-label">
              Usuário ou E-mail Corporativo
            </label>
            <div className="input-wrapper">
              <User className="input-icon" size={18} />
              <input
                id="login-identifier"
                type="text"
                className="form-input"
                placeholder="ex: admin.noc ou seu.email@empresa.com"
                value={loginIdentifier}
                onChange={(e) => setLoginIdentifier(e.target.value)}
                autoComplete="username"
                disabled={isLoading}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <div className="label-with-hint">
              <label htmlFor="login-password" className="form-label">
                Senha de Acesso
              </label>
            </div>
            <div className="input-wrapper">
              <Lock className="input-icon" size={18} />
              <input
                id="login-password"
                type={showLoginPassword ? 'text' : 'password'}
                className="form-input"
                placeholder="••••••••••••"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                autoComplete="current-password"
                disabled={isLoading}
                required
              />
              <button
                type="button"
                id="toggle-login-password-btn"
                className="input-action-btn"
                onClick={() => setShowLoginPassword(!showLoginPassword)}
                title={showLoginPassword ? 'Ocultar senha' : 'Ver senha'}
              >
                {showLoginPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div className="form-options">
            <label className="checkbox-container">
              <input type="checkbox" id="remember-me-checkbox" defaultChecked />
              <span className="checkbox-custom"></span>
              <span className="checkbox-text">Manter conectado neste terminal</span>
            </label>
          </div>

          <button
            type="submit"
            id="login-submit-btn"
            className="btn-submit"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 size={18} className="spin-icon" />
                <span>Autenticando no NOC...</span>
              </>
            ) : (
              <>
                <span>Acessar Painel de Controle</span>
                <ArrowRight size={18} />
              </>
            )}
          </button>

          {/* Quick Demo Helper */}
          <div className="demo-helper-box">
            <button
              type="button"
              className="btn-demo-fill"
              onClick={() => fillDemoData('login')}
            >
              <Sparkles size={14} />
              <span>Preencher com credenciais sugeridas</span>
            </button>
          </div>
        </form>
      )}

      {/* REGISTER FORM */}
      {activeTab === 'register' && (
        <form onSubmit={handleRegisterSubmit} className="auth-form" id="register-form">
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="reg-fullname" className="form-label">
                Nome Completo
              </label>
              <div className="input-wrapper">
                <User className="input-icon" size={18} />
                <input
                  id="reg-fullname"
                  type="text"
                  className="form-input"
                  placeholder="ex: Everton Silva"
                  value={regFullName}
                  onChange={(e) => setRegFullName(e.target.value)}
                  disabled={isLoading}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="reg-username" className="form-label">
                Nome de Usuário (Login)
              </label>
              <div className="input-wrapper">
                <Terminal className="input-icon" size={18} />
                <input
                  id="reg-username"
                  type="text"
                  className="form-input"
                  placeholder="ex: everton.noc"
                  value={regUsername}
                  onChange={(e) => setRegUsername(e.target.value)}
                  autoComplete="username"
                  disabled={isLoading}
                  required
                />
              </div>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="reg-email" className="form-label">
                E-mail Corporativo
              </label>
              <div className="input-wrapper">
                <Mail className="input-icon" size={18} />
                <input
                  id="reg-email"
                  type="email"
                  className="form-input"
                  placeholder="everton@empresa.com.br"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  autoComplete="email"
                  disabled={isLoading}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="reg-role" className="form-label">
                Perfil de Acesso
              </label>
              <div className="input-wrapper">
                <ShieldCheck className="input-icon" size={18} />
                <select
                  id="reg-role"
                  className="form-input form-select"
                  value={regRole}
                  onChange={(e) => setRegRole(e.target.value)}
                  disabled={isLoading}
                >
                  <option value="admin">Administrador de Redes (Full Access)</option>
                  <option value="noc_operator">Operador NOC (Monitoramento & Ação)</option>
                  <option value="viewer">Visualizador / Auditor (Somente Leitura)</option>
                </select>
              </div>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="reg-password" className="form-label">
                Senha Segura
              </label>
              <div className="input-wrapper">
                <Lock className="input-icon" size={18} />
                <input
                  id="reg-password"
                  type={showRegPassword ? 'text' : 'password'}
                  className="form-input"
                  placeholder="Mínimo 6 caracteres"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  disabled={isLoading}
                  required
                />
                <button
                  type="button"
                  id="toggle-reg-password-btn"
                  className="input-action-btn"
                  onClick={() => setShowRegPassword(!showRegPassword)}
                  title={showRegPassword ? 'Ocultar senha' : 'Ver senha'}
                >
                  {showRegPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              {/* Password strength bar */}
              {regPassword && (
                <div className="pwd-strength-container">
                  <div className="pwd-strength-meter">
                    <div 
                      className="pwd-strength-bar" 
                      style={{ 
                        width: `${(pwdStrength.score / 4) * 100}%`,
                        backgroundColor: pwdStrength.color 
                      }} 
                    />
                  </div>
                  <span className="pwd-strength-text" style={{ color: pwdStrength.color }}>
                    Força: {pwdStrength.label}
                  </span>
                </div>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="reg-confirm-password" className="form-label">
                Confirmar Senha
              </label>
              <div className="input-wrapper">
                <Lock className="input-icon" size={18} />
                <input
                  id="reg-confirm-password"
                  type={showRegPassword ? 'text' : 'password'}
                  className={`form-input ${
                    regConfirmPassword && regPassword !== regConfirmPassword ? 'input-error' : ''
                  }`}
                  placeholder="Repita a senha"
                  value={regConfirmPassword}
                  onChange={(e) => setRegConfirmPassword(e.target.value)}
                  disabled={isLoading}
                  required
                />
              </div>
              {regConfirmPassword && regPassword !== regConfirmPassword && (
                <span className="field-hint-error">As senhas não coincidem</span>
              )}
            </div>
          </div>

          <button
            type="submit"
            id="register-submit-btn"
            className="btn-submit"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 size={18} className="spin-icon" />
                <span>Registrando Usuário...</span>
              </>
            ) : (
              <>
                <span>Cadastrar e Iniciar Sessão</span>
                <ArrowRight size={18} />
              </>
            )}
          </button>

          {/* Quick Demo Helper */}
          <div className="demo-helper-box">
            <button
              type="button"
              className="btn-demo-fill"
              onClick={() => fillDemoData('register')}
            >
              <Sparkles size={14} />
              <span>Preencher dados de exemplo</span>
            </button>
          </div>
        </form>
      )}

      {/* Footer system integration tags */}
      <div className="auth-card-footer">
        <div className="integrations-label">
          <Activity size={12} className="pulse-dot" />
          <span>Integrações prontas para conexão unificada:</span>
        </div>
        <div className="integrations-tags">
          <span className="integration-tag">Zabbix Server</span>
          <span className="integration-tag">Apache Guacamole</span>
          <span className="integration-tag">Oxidized</span>
          <span className="integration-tag">phpIPAM</span>
          <span className="integration-tag">Grafana / Promtail</span>
          <span className="integration-tag">NfSen / Netflow</span>
        </div>
      </div>
    </div>
  );
};
