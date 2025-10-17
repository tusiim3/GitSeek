import axios from 'axios'

const API_URL = 'http://localhost:5000'

const api = axios.create({
  baseURL: API_URL,
  withCredentials: true
})

// Search repos with pagination 
export const searchRepos = async (query, filters = {}, page = 1) => {
  const response = await api.get('/api/search', { 
    params: { 
      q: query,
      languages: filters.languages?.join(',') || '',
      dateFilter: filters.dateFilter || 'all',
      page: page  
    } 
  })
  return response.data
}

export const getCurrentUser = async () => {
  try {
    const response = await api.get('/auth/user')
    return response.data.user
  } catch (error) {
    return null
  }
}

export const checkRememberPrompt = async () => {
  try {
    const response = await api.get('/auth/check-prompt')
    return response.data.showPrompt
  } catch (error) {
    return false
  }
}

export const setRememberPreference = async (remember) => {
  const response = await api.post('/auth/remember', { remember })
  return response.data
}

export const logout = async () => {
  await api.get('/auth/logout')
}

export const trackRepoVisit = async (repoUrl, repoName, repoData) => {
  await api.post('/api/track-visit', { repoUrl, repoName, repoData })
}

export const getMostVisited = async () => {
  const response = await api.get('/api/most-visited')
  return response.data.repos
}

export const getAuthUrl = () => `${API_URL}/auth/github`