import axios from 'axios';

const api = axios.create({
  // Dev: VITE_API_URL=http://localhost:8090 → http://localhost:8090/api
  // Prod: VITE_API_URL="" → /api (Nginx proxies it to backend)
  baseURL: import.meta.env.VITE_API_URL
    ? import.meta.env.VITE_API_URL + '/api'
    : '/api',
  timeout: 10000,
});

const token = localStorage.getItem('fs_token');
if (token) api.defaults.headers.common['Authorization'] = `Bearer ${token}`;

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('fs_token');
      localStorage.removeItem('fs_user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
