import './RememberMeModal.css'
import { useEffect } from 'react'

function RememberMeModal({ user, onRemember, onForget, onDismiss }) {
  // Handle ESC key press to dismiss modal
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onDismiss()
      }
    }
    
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onDismiss])

  // Handle clicking outside modal
  const handleOverlayClick = (e) => {
    if (e.target.className === 'modal-overlay') {
      onDismiss()
    }
  }

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-content">
        <h2>Welcome, {user.displayName || user.username}!</h2>
        <p>Would you like us to remember your login?</p>
        
        <div className="modal-info">
          <div className="info-item">
            <span>Stay logged in across sessions</span>
          </div>
          <div className="info-item">
            <span>Your data is stored securely</span>
          </div>
          <div className="info-item">
            <span>Quick access next time you visit</span>
          </div>
        </div>

        <div className="modal-buttons">
          <button onClick={onRemember} className="btn-remember">
            Yes, Remember Me
          </button>
          <button onClick={onForget} className="btn-forget">
            No, Don't Remember
          </button>
        </div>
      </div>
    </div>
  )
}

export default RememberMeModal