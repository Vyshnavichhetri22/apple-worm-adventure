/**
 * @file api.js
 * @description Centralized, fetch-based API client for Apple Worm Adventure.
 * Automatically injects JWT Bearer tokens from localStorage, normalizes
 * error responses, and guards against malformed JSON or network failures.
 */

const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/+$/, '');
const TOKEN_STORAGE_KEY = 'veloop_apple_worm_token';

/**
 * Custom error class representing an API or network failure.
 */
export class ApiError extends Error {
  constructor(message, status = 500, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Universal request handler.
 * @param {string} endpoint - Relative API endpoint (e.g., '/auth/login').
 * @param {Object} options - Standard fetch options.
 * @returns {Promise<any>} Parsed response data.
 */
async function request(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  
  const headers = {
    'Accept': 'application/json',
    ...(options.headers || {})
  };

  // Automatically attach JWT token if available
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Set Content-Type for JSON payloads
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const config = {
    ...options,
    headers
  };

  let response;
  try {
    response = await fetch(url, config);
  } catch (networkError) {
    throw new ApiError(
      'Unable to connect to the game server. Please verify your connection or try again later.',
      0,
      { originalError: networkError.message }
    );
  }

  // Handle empty 204 responses
  if (response.status === 204) {
    return null;
  }

  let responseData;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      responseData = await response.json();
    } catch (_jsonErr) {
      responseData = null;
    }
  } else {
    try {
      responseData = await response.text();
    } catch (_textErr) {
      responseData = null;
    }
  }

  if (!response.ok) {
    const errorMessage =
      (responseData && typeof responseData === 'object' && responseData.message) ||
      (typeof responseData === 'string' && responseData.trim().length > 0 ? responseData : null) ||
      `HTTP Error ${response.status}: ${response.statusText}`;

    throw new ApiError(errorMessage, response.status, responseData);
  }

  return responseData;
}

export const api = {
  get: (endpoint, options = {}) => request(endpoint, { ...options, method: 'GET' }),
  post: (endpoint, body, options = {}) => request(endpoint, { ...options, method: 'POST', body }),
  put: (endpoint, body, options = {}) => request(endpoint, { ...options, method: 'PUT', body }),
  delete: (endpoint, options = {}) => request(endpoint, { ...options, method: 'DELETE' }),
  getTokenKey: () => TOKEN_STORAGE_KEY
};

export default api;