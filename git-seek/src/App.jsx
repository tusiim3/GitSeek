import { useState, useEffect } from 'react'
import './App.css'
import { searchRepos, getCurrentUser, logout, getAuthUrl, trackRepoVisit, checkRememberPrompt, setRememberPreference, getMostVisited } from './api/api'
import RememberMeModal from './components/RememberMeModal'
import LoadingSpinner from './components/LoadingSpinner'

function App() {
  const [searchQuery, setSearchQuery] = useState('')
  const [repositories, setRepositories] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [user, setUser] = useState(null)
  const [showWhyLink, setShowWhyLink] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [showRememberModal, setShowRememberModal] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [recentRepos, setRecentRepos] = useState([])
  const [filters, setFilters] = useState({
    languages: [],
    dateFilter: 'all'
  })

  const popularLanguages = [
    'JavaScript', 'Python', 'Java', 'TypeScript', 'C++', 'C#', 'PHP', 'Ruby', 'Go', 'Rust', 'Swift', 'Kotlin', 'Dart', 'HTML', 'CSS'
  ]

  // Initialize authentication on app load
  useEffect(() => {
    const initAuth = async () => {
      const currentUser = await getCurrentUser()
      
      if (currentUser) {
        setUser(currentUser)
        
        // Check if user needs to see "remember me" prompt
        setTimeout(async () => {
          const shouldShowPrompt = await checkRememberPrompt()
          if (shouldShowPrompt) {
            setShowRememberModal(true)
          }
        }, 500)
      }
    }
    
    initAuth()
  }, [])

  // Load user's recently visited repos 
  const loadUserData = async () => {
    try {
      const visited = await getMostVisited()
      setRecentRepos(visited.slice(0, 3))  
    } catch (err) {
      console.error('Error loading user data:', err)
    }
  }

  // Load recent repos whenever user changes (login/logout)
  useEffect(() => {
    if (user) {
      loadUserData()
    }
  }, [user])

  // Handle "remember me" choice or modal dismissal
  const handleRememberChoice = async (remember) => {
    await setRememberPreference(remember)
    setShowRememberModal(false)
  }

  const handleModalDismiss = () => {
    handleRememberChoice(true)
  }

  const handleLanguageToggle = (language) => {
    setFilters(prev => ({
      ...prev,
      languages: prev.languages.includes(language)
        ? prev.languages.filter(l => l !== language)
        : [...prev.languages, language]
    }))
  }

  const handleDateFilterChange = (dateFilter) => {
    setFilters(prev => ({ ...prev, dateFilter }))
  }

  const clearFilters = () => {
    setFilters({ languages: [], dateFilter: 'all' })
  }

  const handleSearch = async (e, pageNum = 1) => {
    if (e) e.preventDefault()
    if (!searchQuery.trim()) return

    setLoading(true)
    setError(null)
    
    // Reset to page 1 only on new searches, not on page changes
    if (e) {
      setCurrentPage(1)
      pageNum = 1
    }

    try {
      // Fetch specific page from GitHub API
      const data = await searchRepos(searchQuery, filters, pageNum)
      
      setRepositories(data.items || [])
      // Calculate total pages from GitHub's total count
      const maxPages = Math.min(Math.ceil(data.total_count / 30), 34)
      setTotalPages(maxPages)
    } catch (err) {
      setError(err.message)
      setRepositories([])
      setTotalPages(0)
    } finally {
      setLoading(false)
    }
  }

  // Track when user clicks on a repo
  const handleRepoClick = async (repo) => {
    if (user) {
      await trackRepoVisit(repo.html_url, repo.full_name, {
        description: repo.description,
        stargazers_count: repo.stargazers_count,
        language: repo.language
      })
      // Refresh "Jump Back In" section
      loadUserData()
    }
  }

  const handleLogout = async () => {
    await logout()
    setUser(null)
    setShowRememberModal(false)
    setRecentRepos([])
    window.location.reload()
  }

  // Navigate to a different page
  const goToPage = (page) => {
    setCurrentPage(page)
    handleSearch(null, page) 
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const hasActiveFilters = filters.languages.length > 0 || filters.dateFilter !== 'all'

  return (
    <div className="app">
      {showRememberModal && user && (
        <RememberMeModal
          user={user}
          onRemember={() => handleRememberChoice(true)}
          onForget={() => handleRememberChoice(false)}
          onDismiss={handleModalDismiss}
        />
      )}

      {user && (
        <div className="user-section">
          <div className="user-profile">
            <img src={user.avatar} alt={user.username} className="avatar" />
            <span>{user.displayName || user.username}</span>
            <button onClick={handleLogout} className="logout-btn">Logout</button>
          </div>
        </div>
      )}

      <h1>GitSeek - GitHub Repository Search</h1>
      
      <form onSubmit={handleSearch}>
        <div className="search-input-wrapper">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search GitHub repositories..."
          />
        </div>
        <div className="search-actions">
          <button 
            type="button" 
            className="filter-toggle-btn"
            onClick={() => setShowFilters(!showFilters)}
          >
            Filters {hasActiveFilters && `(${filters.languages.length + (filters.dateFilter !== 'all' ? 1 : 0)})`}
          </button>
          {searchQuery && (
            <button type="submit" disabled={loading}>
              {loading ? 'Searching...' : 'Search'}
            </button>
          )}
        </div>
      </form>

      {loading && <LoadingSpinner />}

      {/* Jump Back In Section */}
      {!loading && user && recentRepos.length > 0 && repositories.length === 0 && (
        <div className="jump-back-in">
          <h2>⚡ Jump Back In</h2>
          <p className="jump-subtitle">Your recently accessed repositories</p>
          
          <div className="recent-repos-grid">
            {recentRepos.map((repo, index) => (
              <a
                key={index}
                href={repo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="recent-repo-card"
              >
                <div className="recent-repo-header">
                  <h3>{repo.name}</h3>
                  <span className="recent-badge">{repo.count} visits</span>
                </div>
                <p className="recent-repo-desc">
                  {repo.description || 'No description available'}
                </p>
                <div className="recent-repo-stats">
                  <span>⭐ {repo.stars?.toLocaleString() || 0}</span>
                  <span>💻 {repo.language}</span>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
      
      {/* Filters Panel */}
      {showFilters && (
        <div className="filters-panel">
          <div className="filter-section">
            <h3>Programming Languages</h3>
            <div className="language-chips">
              {popularLanguages.map(lang => (
                <button
                  key={lang}
                  type="button"
                  className={`language-chip ${filters.languages.includes(lang) ? 'active' : ''}`}
                  onClick={() => handleLanguageToggle(lang)}
                >
                  {lang}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <h3>Last Updated</h3>
            <div className="date-filters">
              {[
                { value: 'all', label: 'Any Time' },
                { value: 'week', label: 'Past Week' },
                { value: 'month', label: 'Past Month' },
                { value: 'year', label: 'Past Year' }
              ].map(option => (
                <button
                  key={option.value}
                  type="button"
                  className={`date-filter-btn ${filters.dateFilter === option.value ? 'active' : ''}`}
                  onClick={() => handleDateFilterChange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {hasActiveFilters && (
            <button className="clear-filters-btn" onClick={clearFilters}>
              Clear All Filters
            </button>
          )}
        </div>
      )}

      {/* Active Filters Display */}
      {hasActiveFilters && (
        <div className="active-filters">
          {filters.languages.map(lang => (
            <span key={lang} className="filter-badge">
              {lang}
              <button onClick={() => handleLanguageToggle(lang)}>×</button>
            </span>
          ))}
          {filters.dateFilter !== 'all' && (
            <span className="filter-badge">
              Updated: {filters.dateFilter}
              <button onClick={() => handleDateFilterChange('all')}>×</button>
            </span>
          )}
        </div>
      )}

      {!user && !showRememberModal && (
        <div className="link-account-section">
          <a href={getAuthUrl()} className="link-github-btn">
            Link Your GitHub Account
          </a>
          <button 
            className="why-link-btn" 
            onClick={() => setShowWhyLink(!showWhyLink)}
          >
            Why should I link my GitHub account?
          </button>
          
          {showWhyLink && (
            <div className="why-link-dropdown">              
              <ul>
                <li>
                  -Access and search through your private repositories
                  <br></br>-Get 5,000 API requests per hour instead of just 60
                  <br></br>-Save and revisit your recent searches
                  <br></br>-Keep track of your most visited repositories
                </li>
                <li>
                  Remember, OAuth authentication keeps your credentials safe - we never see your password
                </li>
              </ul>
            </div>
          )}
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {!loading && (
        <div className="results">
          {repositories.map((repo) => (
            <div key={repo.id} className="repo-card">
              <h3>
                <a 
                  href={repo.html_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  onClick={() => handleRepoClick(repo)}
                  title={repo.full_name}
                >
                  {repo.full_name}
                </a>
              </h3>
              <p>{repo.description || 'No description available'}</p>
              <div className="repo-stats">
                <span>⭐ {repo.stargazers_count.toLocaleString()}</span>
                <span>🍴 {repo.forks_count.toLocaleString()}</span>
                <span>💻 {repo.language || 'N/A'}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Real pagination */}
      {repositories.length > 0 && totalPages > 1 && (
        <div className="pagination">
          <button 
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
            className="page-btn"
          >
            ← Previous
          </button>

          <div className="page-numbers">
            {[...Array(totalPages)].map((_, index) => {
              const pageNum = index + 1
              // Show: first page, last page, current page, and pages adjacent to current
              if (
                pageNum === 1 || 
                pageNum === totalPages || 
                (pageNum >= currentPage - 1 && pageNum <= currentPage + 1)
              ) {
                return (
                  <button
                    key={pageNum}
                    onClick={() => goToPage(pageNum)}
                    className={`page-number ${currentPage === pageNum ? 'active' : ''}`}
                  >
                    {pageNum}
                  </button>
                )
              } else if (pageNum === currentPage - 2 || pageNum === currentPage + 2) {
                return <span key={pageNum} className="page-ellipsis">...</span>
              }
              return null
            })}
          </div>

          <button 
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="page-btn"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}

export default App