/**
 * Tiny API client for the Online Organic Food System backends.
 * Works with the Python (Flask) and Node.js (Express) servers (REST style).
 * For the PHP backend, call  php/api.php?action=<name>  instead (see README).
 *
 * Usage:
 *   const api = createApi('');            // same origin (Flask / Express serve demo.html)
 *   await api.login('customer@organicfood.demo', 'customer123');
 *   const products = await api.products();
 */
function createApi(base = '') {
  async function call(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  return {
    products: () => call('GET', '/api/products'),
    register: (name, email, password) => call('POST', '/api/register', { name, email, password }),
    login: (email, password) => call('POST', '/api/login', { email, password }),
    logout: () => call('POST', '/api/logout'),
    me: () => call('GET', '/api/me'),
    placeOrder: (order) => call('POST', '/api/orders', order), // {name, phone, address, payment, note, items:[{id, qty}]}
    myOrders: () => call('GET', '/api/orders'),
    cancelOrder: (id) => call('POST', `/api/orders/${id}/cancel`),
    admin: {
      orders: () => call('GET', '/api/admin/orders'),
      setStatus: (id, status) => call('PATCH', `/api/admin/orders/${id}`, { status }),
      saveProduct: (p) => (p.id ? call('PUT', `/api/admin/products/${p.id}`, p) : call('POST', '/api/admin/products', p)),
      deleteProduct: (id) => call('DELETE', `/api/admin/products/${id}`),
    },
  };
}
