const getApiBaseUrl = () => {
  const envUrl = import.meta.env.VITE_API_BASE_URL;
  if (envUrl && envUrl.startsWith('http') && !envUrl.includes('localhost:8000')) {
    return envUrl;
  }
  // No navegador, usa rota relativa para passar pelo proxy do Vite/Nginx ou aponta para o mesmo host
  if (typeof window !== 'undefined') {
    return '/api/v1';
  }
  return 'http://localhost:8000/api/v1';
};

const API_BASE_URL = getApiBaseUrl();


export const authService = {
  getToken() {
    return localStorage.getItem('ipersoft_token');
  },

  setToken(token) {
    if (token) {
      localStorage.setItem('ipersoft_token', token);
    } else {
      localStorage.removeItem('ipersoft_token');
    }
  },

  getUser() {
    const raw = localStorage.getItem('ipersoft_user');
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  setUser(user) {
    if (user) {
      localStorage.setItem('ipersoft_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('ipersoft_user');
    }
  },

  logout() {
    localStorage.removeItem('ipersoft_token');
    localStorage.removeItem('ipersoft_user');
  },

  async login(username_or_email, password) {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username_or_email,
        password,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || 'Falha na autenticação.');
    }

    this.setToken(data.access_token);
    this.setUser(data.user);
    return data;
  },

  async getMe() {
    const token = this.getToken();
    if (!token) return null;

    const response = await fetch(`${API_BASE_URL}/auth/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      this.logout();
      return null;
    }

    const data = await response.json();
    this.setUser(data);
    return data;
  },

  // Admin User Management
  async listUsers() {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/users`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || 'Falha ao carregar lista de usuários.');
    }
    return data;
  },

  async createUser({ username, email, full_name, password, role }) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/users`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username,
        email,
        full_name,
        password,
        role: role || 'noc_operator',
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || 'Falha ao cadastrar usuário.');
    }
    return data;
  },

  async deleteUser(userId) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/users/${userId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || 'Falha ao excluir usuário.');
    }
    return true;
  },

  // Zabbix Integration
  async getZabbixConfig() {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/integrations/zabbix/config`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) return null;
    return await response.json();
  },

  async saveZabbixConfig({ url, token: zabbixToken, username, password }) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/integrations/zabbix/config`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url,
        token: zabbixToken,
        username,
        password
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao salvar configuração do Zabbix.');
    return data;
  },

  async testZabbixConnection({ url, token: zabbixToken, username, password }) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/integrations/zabbix/test`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url,
        token: zabbixToken,
        username,
        password
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao conectar no Zabbix.');
    return data;
  },

  async previewZabbixHosts() {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/integrations/zabbix/preview`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao obter hosts do Zabbix.');
    return data;
  },

  async syncZabbixHosts() {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/integrations/zabbix/sync`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao sincronizar hosts do Zabbix.');
    return data;
  },

  async getZabbixProblems({ search, severity, acknowledged } = {}) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (severity !== undefined && severity !== null && severity !== '') params.append('severity', severity);
    if (acknowledged !== undefined && acknowledged !== null && acknowledged !== '') params.append('acknowledged', acknowledged);

    const url = `${API_BASE_URL}/integrations/zabbix/problems${params.toString() ? `?${params.toString()}` : ''}`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao buscar alarmes do Zabbix.');
    return data;
  },

  async acknowledgeZabbixProblem({ eventid, triggerid, acknowledged = true, message }) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/integrations/zabbix/acknowledge`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        eventid,
        triggerid,
        acknowledged,
        message
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao atualizar reconhecimento do alarme.');
    return data;
  },

  // Assets Management
  async getAssets({ search, group, status, presence, sort_by, sort_dir } = {}) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (group) params.append('group', group);
    if (status) params.append('status', status);
    if (presence) params.append('presence', presence);
    if (sort_by) params.append('sort_by', sort_by);
    if (sort_dir) params.append('sort_dir', sort_dir);

    const url = `${API_BASE_URL}/assets${params.toString() ? `?${params.toString()}` : ''}`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao buscar ativos.');
    return data;
  },

  async getAssetStats() {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/assets/stats`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao buscar métricas de ativos.');
    return data;
  },

  async deleteAsset(id) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/assets/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || 'Falha ao excluir ativo.');
    }
    return true;
  },

  async updateAsset(id, data) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/assets/${id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'Falha ao atualizar ativo.');
    return result;
  },

  async toggleAssetStatus(id, status, syncZabbix = true) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/assets/${id}/status`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status,
        sync_zabbix: syncZabbix
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'Falha ao alterar status do ativo.');
    return result;
  },

  async getAssetComparison(id) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/assets/${id}/comparison`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'Falha ao obter comparativo do ativo.');
    return result;
  },

  async syncAssetToZabbix(id) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/assets/${id}/sync-zabbix`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'Falha ao sincronizar com Zabbix.');
    return result;
  },

  async syncAssetToGuacamole(id, data = null) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };
    if (data) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(data);
    }

    const response = await fetch(`${API_BASE_URL}/assets/${id}/sync-guacamole`, options);
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'Falha ao sincronizar com Guacamole.');
    return result;
  },

  async removeAssetFromGuacamole(id) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/assets/${id}/guacamole`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'Falha ao remover do Guacamole.');
    return result;
  },

  async syncAssetToAll(id) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/assets/${id}/sync-all`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'Falha ao sincronizar plataformas.');
    return result;
  },

  // Detalhes sob demanda (Lazy Loading) e Monitoramento
  async getAssetZabbixDetails(id) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/assets/${id}/zabbix/details`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao buscar detalhes do Zabbix.');
    return data;
  },

  async getAssetZabbixProblems(id) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/assets/${id}/zabbix/problems`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao buscar alarmes do Zabbix.');
    return data;
  },

  async getAssetZabbixItems(id, search = '') {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const url = new URL(`${window.location.origin}${API_BASE_URL}/assets/${id}/zabbix/items`);
    if (search) url.searchParams.append('search', search);

    const response = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao buscar itens do Zabbix.');
    return data;
  },

  async getAssetZabbixItemHistory(id, itemId, period = '1h', valueType = 0) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const url = new URL(`${window.location.origin}${API_BASE_URL}/assets/${id}/zabbix/items/${itemId}/history`);
    url.searchParams.append('period', period);
    url.searchParams.append('value_type', valueType);

    const response = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao buscar histórico do item.');
    return data;
  },

  async getAssetGuacamoleDetails(id) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/assets/${id}/guacamole/details`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao buscar detalhes do Guacamole.');
    return data;
  },

  async getAssetGuacamoleLaunchUrl(id) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/assets/${id}/guacamole/launch-url`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao gerar sessão do Guacamole.');
    return data;
  },

  async getAssetOxidizedDetails(id) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/assets/${id}/oxidized/details`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao buscar detalhes do Oxidized.');
    return data;
  },


  // Guacamole Integration
  async getGuacamoleConfig() {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/integrations/guacamole/config`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) return null;
    return await response.json();
  },

  async saveGuacamoleConfig({ url, username, password }) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/integrations/guacamole/config`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url, username, password })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao salvar configuração do Guacamole.');
    return data;
  },

  async testGuacamoleConnection({ url, username, password }) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/integrations/guacamole/test`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url, username, password })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao testar conexão com o Guacamole.');
    return data;
  },

  async matchGuacamoleConnections() {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/integrations/guacamole/match`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao vincular conexões do Guacamole.');
    return data;
  },

  // Oxidized Integration
  async getOxidizedConfig() {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/integrations/oxidized/config`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) return null;
    return await response.json();
  },

  async saveOxidizedConfig({ url, username, password }) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/integrations/oxidized/config`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url, username, password })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao salvar configuração do Oxidized.');
    return data;
  },

  async testOxidizedConnection({ url, username, password }) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/integrations/oxidized/test`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url, username, password })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao testar conexão com o Oxidized.');
    return data;
  },

  async syncOxidizedNodes() {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/integrations/oxidized/sync`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao sincronizar nós do Oxidized.');
    return data;
  },

  async getAssetOxidizedConfig(assetId) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/integrations/oxidized/assets/${assetId}/config`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao obter configuração do Oxidized.');
    return data;
  },

  async triggerAssetOxidizedBackup(assetId) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/integrations/oxidized/assets/${assetId}/backup`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao disparar backup no Oxidized.');
    return data;
  }
};

export const diagnosticsService = {
  async getStats() {
    const token = authService.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/diagnostics/stats`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) throw new Error('Falha ao obter estatísticas de diagnóstico.');
    return await response.json();
  },

  async getAlarms({ testType = 'all', search = '', onlyFailures = true } = {}) {
    const token = authService.getToken();
    if (!token) throw new Error('Não autenticado.');

    const params = new URLSearchParams();
    if (testType && testType !== 'all') params.append('test_type', testType);
    if (search) params.append('search', search);
    params.append('only_failures', onlyFailures);

    const response = await fetch(`${API_BASE_URL}/diagnostics/alarms?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) throw new Error('Falha ao listar alarmes de conectividade.');
    return await response.json();
  },

  async runBatch() {
    const token = authService.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/diagnostics/run`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao disparar diagnósticos.');
    return data;
  },

  async testAsset(assetId, options = {}) {
    const token = authService.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/diagnostics/test-asset/${assetId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(options)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao testar ativo.');
    return data;
  }
};

