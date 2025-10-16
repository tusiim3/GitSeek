import './RememberMeModal.css'

function RememberMeModal({ user, onRemember, onForget }) {
  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>Welcome, {user.displayName || user.username}! 👋</h2>
        <p>Would you like us to remember your login?</p>
        
        <div className="modal-info">
          <div className="info-item">
            <span className="icon">✅</span>
            <span>Stay logged in across sessions</span>
          </div>
          <div className="info-item">
            <span className="icon">🔒</span>
            <span>Your data is stored securely</span>
          </div>
          <div className="info-item">
            <span className="icon">⚡</span>
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

        <p className="modal-note">
          You can change this preference anytime from your profile settings
        </p>
      </div>
    </div>
  )
}

export default RememberMeModal