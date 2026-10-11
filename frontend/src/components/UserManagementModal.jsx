import React, { useState, useEffect } from 'react';
import { 
  X, 
  UserPlus, 
  Users, 
  Trash2, 
  Shield, 
  AlertCircle, 
  CheckCircle2, 
  Loader2 
} from 'lucide-react';
import { authService } from '../services/api';

export const UserManagementModal = ({ isOpen, onClose, currentAdminId }) => {
  const [activeTab, setActiveTab] = useState('list'); // 'list' | 'create'
  const [usersList, setUsersList] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // New user form state
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('noc_operator');
  const [password, setPassword] = useState('');

  const fetchUsers = async () => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      const data = await authService.listUsers();
      setUsersList(data);
    } catch (err) {
      setErrorMsg(err.message || 'Erro ao carregar usuários.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchUsers();
      setErrorMsg('');
      setSuccessMsg('');
    }
  }, [isOpen]);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!fullName.trim() || !username.trim() || !email.trim() || !password) {
      setErrorMsg('Preencha todos os campos obrigatórios.');
      return;
    }

    if (password.length < 6) {
      setErrorMsg('A senha precisa ter no mínimo 6 caracteres.');
      return;
    }

    setIsLoading(true);
    try {
      await authService.createUser({
        full_name: fullName.trim(),
        username: username.trim(),
        email: email.trim(),
        role,
        password,
      });

      setSuccessMsg(`Usuário "${username}" cadastrado com sucesso.`);
      setFullName('');
      setUsername('');
      setEmail('');
      setPassword('');
      setRole('noc_operator');
      fetchUsers();
      setActiveTab('list');
    } catch (err) {
      setErrorMsg(err.message || 'Erro ao criar usuário.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteUser = async (user) => {
    if (user.id === currentAdminId) {
      setErrorMsg('Você não pode remover seu próprio usuário.');
      return;
    }

    if (!window.confirm(`Confirma a exclusão do usuário "${user.username}"?`)) {
      return;
    }

    setIsLoading(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      await authService.deleteUser(user.id);
      setSuccessMsg(`Usuário "${user.username}" removido.`);
      fetchUsers();
    } catch (err) {
      setErrorMsg(err.message || 'Erro ao remover usuário.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-title-box">
            <Shield size={20} className="modal-title-icon" />
            <h2 className="modal-title">Gestão de Usuários</h2>
          </div>
          <button className="btn-close-modal" onClick={onClose} title="Fechar">
            <X size={18} />
          </button>
        </div>

        {/* Modal Tabs */}
        <div className="modal-tabs">
          <button
            className={`modal-tab ${activeTab === 'list' ? 'active' : ''}`}
            onClick={() => { setActiveTab('list'); setErrorMsg(''); setSuccessMsg(''); }}
          >
            <Users size={15} />
            <span>Usuários ({usersList.length})</span>
          </button>
          <button
            className={`modal-tab ${activeTab === 'create' ? 'active' : ''}`}
            onClick={() => { setActiveTab('create'); setErrorMsg(''); setSuccessMsg(''); }}
          >
            <UserPlus size={15} />
            <span>Cadastrar Usuário</span>
          </button>
        </div>

        {/* Feedback alerts */}
        {errorMsg && (
          <div className="alert-box alert-error" role="alert">
            <AlertCircle size={15} />
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="alert-box alert-success" role="status">
            <CheckCircle2 size={15} />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Modal Body */}
        <div className="modal-body">
          {activeTab === 'list' && (
            <div className="users-table-wrapper">
              {isLoading && usersList.length === 0 ? (
                <div className="loading-state">
                  <Loader2 size={24} className="spin-icon" />
                  <span>Carregando...</span>
                </div>
              ) : (
                <table className="users-table">
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>Usuário</th>
                      <th>E-mail</th>
                      <th>Perfil</th>
                      <th style={{ textAlign: 'right' }}>Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usersList.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <strong>{u.full_name}</strong>
                          {u.id === currentAdminId && <span className="tag-current"> (Você)</span>}
                        </td>
                        <td><code>{u.username}</code></td>
                        <td>{u.email}</td>
                        <td>
                          <span className={`role-badge role-${u.role}`}>
                            {u.role === 'admin' ? 'Administrador' : u.role === 'viewer' ? 'Visualizador' : 'Operador NOC'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {u.id !== currentAdminId && (
                            <button
                              className="btn-delete-user"
                              onClick={() => handleDeleteUser(u)}
                              title="Excluir usuário"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {activeTab === 'create' && (
            <form onSubmit={handleCreateUser} className="admin-create-form">
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Nome Completo</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Nome do operador ou técnico"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Nome de Usuário (Login)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="ex: joao.noc"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">E-mail Corporativo</label>
                  <input
                    type="email"
                    className="form-input"
                    placeholder="usuario@empresa.com.br"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Perfil de Acesso</label>
                  <select
                    className="form-input"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                  >
                    <option value="noc_operator">Operador NOC</option>
                    <option value="admin">Administrador</option>
                    <option value="viewer">Visualizador</option>
                  </select>
                </div>

                <div className="form-group" style={{ gridColumn: 'span 2' }}>
                  <label className="form-label">Senha Inicial</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="Mínimo 6 caracteres"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-actions-right">
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={isLoading}
                  style={{ width: 'auto', padding: '0.65rem 1.4rem' }}
                >
                  {isLoading ? 'Cadastrando...' : 'Cadastrar Usuário'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
