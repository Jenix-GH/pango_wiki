import { useEffect } from 'react'
import './ImageLightbox.css'

interface Props {
  src: string | null
  onClose: () => void
}

export default function ImageLightbox({ src, onClose }: Props) {
  useEffect(() => {
    if (!src) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [src, onClose])

  if (!src) return null
  return (
    <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="原图预览" onClick={onClose}>
      <button className="image-lightbox-close" type="button" aria-label="关闭原图预览" onClick={onClose}>×</button>
      <img src={src} alt="原图预览" onClick={(event) => event.stopPropagation()} />
    </div>
  )
}
