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

/**
 * Executa chamadas HTTP de forma resiliente a respostas não-JSON (HTML 404/500/502).
 * Evita o erro 'Unexpected token < in JSON at position 0' e extrai detalhes de validação legíveis.
 */
export async function safeFetchJson(url, options = {}, defaultErrorMsg = 'Erro na requisição') {
  let response;
  try {
    response = await fetch(url, options);
  } catch (netErr) {
    throw new Error(`Falha de conexão com o servidor: ${netErr.message}`);
  }

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (jsonErr) {
    if (!response.ok) {
      throw new Error(`${defaultErrorMsg} (HTTP ${response.status}: ${response.statusText || 'Erro no servidor'})`);
    }
    throw new Error('A resposta do servidor não é um JSON válido.');
  }

  if (!response.ok) {
    let msg = defaultErrorMsg;
    if (data && data.detail) {
      if (typeof data.detail === 'string') {
        msg = data.detail;
      } else if (Array.isArray(data.detail)) {
        msg = data.detail.map(d => d.msg || (typeof d === 'object' ? JSON.stringify(d) : String(d))).join('; ');
      } else {
        msg = JSON.stringify(data.detail);
      }
    } else if (data && data.message) {
      msg = data.message;
    } else if (data && data.error) {
      msg = data.error;
    } else {
      msg = `${defaultErrorMsg} (HTTP ${response.status})`;
    }
    throw new Error(msg);
  }

  return data;
}


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

  async closeZabbixProblem({ eventid, triggerid, message }) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/integrations/zabbix/close`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        eventid,
        triggerid,
        message
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao encerrar alarme no Zabbix.');
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
    if (!id || id === 'undefined') throw new Error('ID do ativo não informado ou inválido.');
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    return safeFetchJson(`${API_BASE_URL}/assets/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    }, 'Falha ao excluir ativo.');
  },

  async updateAsset(id, data) {
    if (!id || id === 'undefined') throw new Error('ID do ativo não informado ou inválido.');
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    return safeFetchJson(`${API_BASE_URL}/assets/${id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    }, 'Falha ao atualizar ativo.');
  },

  async toggleAssetStatus(id, status) {
    if (!id || id === 'undefined') throw new Error('ID do ativo não informado ou inválido.');
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    return safeFetchJson(`${API_BASE_URL}/assets/${id}/status`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status
      })
    }, 'Falha ao alterar status do ativo.');
  },

  async toggleZabbixHostStatus(id, isMonitored) {
    return this.toggleAssetStatus(id, isMonitored ? 'monitored' : 'unmonitored');
  },

  async bulkUpdateIntegrations({ asset_ids, zabbix_enabled, guacamole_enabled, oxidized_enabled }) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    return safeFetchJson(`${API_BASE_URL}/assets/bulk-integrations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        asset_ids,
        zabbix_enabled,
        guacamole_enabled,
        oxidized_enabled
      })
    }, 'Falha ao atualizar integrações em lote.');
  },

  async getAssetComparison(id) {
    if (!id || id === 'undefined') throw new Error('ID do ativo não informado ou inválido.');
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    return safeFetchJson(`${API_BASE_URL}/assets/${id}/comparison`, {
      headers: { 'Authorization': `Bearer ${token}` }
    }, 'Falha ao obter comparativo do ativo.');
  },

  async syncAssetToZabbix(id) {
    if (!id || id === 'undefined') throw new Error('ID do ativo não informado ou inválido.');
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    return safeFetchJson(`${API_BASE_URL}/assets/${id}/sync-zabbix`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    }, 'Falha ao sincronizar com Zabbix.');
  },

  async syncAssetToGuacamole(id, data = null) {
    if (!id || id === 'undefined') throw new Error('ID do ativo não informado ou inválido.');
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

    return safeFetchJson(`${API_BASE_URL}/assets/${id}/sync-guacamole`, options, 'Falha ao sincronizar com Guacamole.');
  },

  async removeAssetFromGuacamole(id) {
    if (!id || id === 'undefined') throw new Error('ID do ativo não informado ou inválido.');
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    return safeFetchJson(`${API_BASE_URL}/assets/${id}/guacamole`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    }, 'Falha ao remover do Guacamole.');
  },

  async syncAssetToOxidized(id) {
    if (!id || id === 'undefined') throw new Error('ID do ativo não informado ou inválido.');
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    return safeFetchJson(`${API_BASE_URL}/assets/${id}/sync-oxidized`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    }, 'Falha ao sincronizar com Oxidized.');
  },

  async syncAssetToAll(id) {
    if (!id || id === 'undefined') throw new Error('ID do ativo não informado ou inválido.');
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    return safeFetchJson(`${API_BASE_URL}/assets/${id}/sync-all`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    }, 'Falha ao sincronizar plataformas.');
  },

  // Detalhes sob demanda (Lazy Loading) e Monitoramento
  async getAssetZabbixDetails(id) {
    if (!id || id === 'undefined') throw new Error('ID do ativo não informado ou inválido.');
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    return safeFetchJson(`${API_BASE_URL}/assets/${id}/zabbix/details`, {
      headers: { 'Authorization': `Bearer ${token}` }
    }, 'Falha ao buscar detalhes do Zabbix.');
  },

  async getAssetZabbixProblems(id) {
    if (!id || id === 'undefined') throw new Error('ID do ativo não informado ou inválido.');
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    return safeFetchJson(`${API_BASE_URL}/assets/${id}/zabbix/problems`, {
      headers: { 'Authorization': `Bearer ${token}` }
    }, 'Falha ao buscar alarmes do Zabbix.');
  },

  async getAssetZabbixItems(id, search = '') {
    if (!id || id === 'undefined') throw new Error('ID do ativo não informado ou inválido.');
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const url = new URL(`${window.location.origin}${API_BASE_URL}/assets/${id}/zabbix/items`);
    if (search) url.searchParams.append('search', search);

    return safeFetchJson(url.toString(), {
      headers: { 'Authorization': `Bearer ${token}` }
    }, 'Falha ao buscar itens do Zabbix.');
  },

  async getAssetZabbixItemHistory(id, itemId, period = '1h', valueType = 0) {
    if (!id || id === 'undefined') throw new Error('ID do ativo não informado ou inválido.');
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const url = new URL(`${window.location.origin}${API_BASE_URL}/assets/${id}/zabbix/items/${itemId}/history`);
    url.searchParams.append('period', period);
    url.searchParams.append('value_type', valueType);

    return safeFetchJson(url.toString(), {
      headers: { 'Authorization': `Bearer ${token}` }
    }, 'Falha ao buscar histórico do item.');
  },

  async getAssetGuacamoleDetails(id) {
    if (!id || id === 'undefined') throw new Error('ID do ativo não informado ou inválido.');
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    return safeFetchJson(`${API_BASE_URL}/assets/${id}/guacamole/details`, {
      headers: { 'Authorization': `Bearer ${token}` }
    }, 'Falha ao buscar detalhes do Guacamole.');
  },

  async getAssetGuacamoleLaunchUrl(id) {
    if (!id || id === 'undefined') throw new Error('ID do ativo não informado ou inválido.');
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    return safeFetchJson(`${API_BASE_URL}/assets/${id}/guacamole/launch-url`, {
      headers: { 'Authorization': `Bearer ${token}` }
    }, 'Falha ao gerar sessão do Guacamole.');
  },

  async getAssetOxidizedDetails(id) {
    if (!id || id === 'undefined') throw new Error('ID do ativo não informado ou inválido.');
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    return safeFetchJson(`${API_BASE_URL}/assets/${id}/oxidized/details`, {
      headers: { 'Authorization': `Bearer ${token}` }
    }, 'Falha ao buscar detalhes do Oxidized.');
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

  async saveGuacamoleConfig({ url, username, password, public_url }) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/integrations/guacamole/config`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url, username, password, public_url })
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

  async reloadOxidizedNodes() {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/integrations/oxidized/reload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao recarregar nós do Oxidized.');
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
  },

  // VictoriaLogs (Syslog)
  async getVictoriaLogsConfig() {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/integrations/victorialogs/config`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao obter configuração do VictoriaLogs.');
    return data;
  },

  async saveVictoriaLogsConfig({ url, is_active = true }) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/integrations/victorialogs/config`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url, is_active })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao salvar configuração do VictoriaLogs.');
    return data;
  },

  async testVictoriaLogsConnection({ url } = {}) {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/integrations/victorialogs/test`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao testar conexão com VictoriaLogs.');
    return data;
  },

  async getVictoriaLogsStats() {
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const response = await fetch(`${API_BASE_URL}/integrations/victorialogs/stats`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Falha ao obter estatísticas do VictoriaLogs.');
    return data;
  },

  async getAssetLogs(assetId, { timeRange = '5m', limit = 250, search = '', level = '' } = {}) {
    if (!assetId || assetId === 'undefined') throw new Error('ID do ativo não informado ou inválido.');
    const token = this.getToken();
    if (!token) throw new Error('Não autenticado.');

    const params = new URLSearchParams();
    if (timeRange) params.append('time_range', timeRange);
    if (limit) params.append('limit', limit);
    if (search) params.append('search', search);
    if (level) params.append('level', level);

    return safeFetchJson(`${API_BASE_URL}/assets/${assetId}/logs?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    }, 'Falha ao carregar logs do equipamento.');
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
  },

  async runForAsset(assetId, options = {}) {
    return this.testAsset(assetId, options);
  }
};


