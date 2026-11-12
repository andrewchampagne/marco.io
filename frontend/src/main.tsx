import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@fontsource/google-sans/latin-500.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import './styles/index.css'
import { createRoot } from 'react-dom/client'
import App from './App'
import { boot } from './state/actions'

createRoot(document.getElementById('root')!).render(<App />)
void boot()
