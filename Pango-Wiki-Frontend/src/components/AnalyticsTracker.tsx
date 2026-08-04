import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'

export default function AnalyticsTracker() {
  const location = useLocation()
  const { loading } = useAuth()

  useEffect(() => {
    if (loading) return
    const pagePath = `${location.pathname}${location.search}`
    const clientType = new URLSearchParams(location.search).get('client') === 'miniprogram' ? 'MINIPROGRAM' : 'WEB'
    const events = ['page_view']
    if (location.pathname === '/wiki') events.push('wiki_view')
    if (location.pathname === '/user-guide') events.push('user_guide_view')
    events.forEach((eventName) => {
      void api.trackEvent({ eventName, pagePath, clientType }).catch(() => {})
    })
  }, [loading, location.pathname, location.search])

  return null
}
