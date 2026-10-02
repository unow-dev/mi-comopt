import emblemUrl from './emblem.webp'
import './loading-screen.css'

const loadingCharacters = Array.from('こちらコメント管理局！')

function LoadingBackground() {
  return <div className="loading-background" aria-hidden="true">
    <svg className="loading-background__art" viewBox="0 0 1440 2560" preserveAspectRatio="xMidYMid slice" role="presentation">
      <defs>
        <linearGradient id="loading-background-sky-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop className="loading-background__gradient-start" offset="0" />
          <stop className="loading-background__gradient-end" offset="1" />
        </linearGradient>
      </defs>

      <g className="loading-background__group--top-left">
        <polygon points="0,0 390,0 0,390" fill="url(#loading-background-sky-gradient)" />
        <polygon className="loading-background__fill--01 loading-background__fill--muted" points="42,0 350,0 0,350 0,112" />
        <polygon className="loading-background__fill--02 loading-background__fill--soft" points="285,54 408,174 285,232" />
        <polygon className="loading-background__fill--03 loading-background__fill--subtle" points="395,276 560,388 395,468" />
      </g>

      <g className="loading-background__group--top-right">
        <polygon points="1090,0 1440,0 1440,312 1260,484 1078,484 1218,344 1058,344" fill="url(#loading-background-sky-gradient)" />
        <polygon className="loading-background__fill--04" points="1208,92 1440,92 1440,242 1300,334 1162,334" />
        <polygon className="loading-background__fill--05" points="1284,456 1392,532 1284,605" />
      </g>

      <g className="loading-background__group--mid-left">
        <polygon className="loading-background__fill--06" points="0,625 267,625 0,900" />
        <polygon className="loading-background__fill--05" points="0,860 146,716 146,838 0,980" />
        <polygon className="loading-background__fill--05" points="6,1150 136,1040 136,1194" />
      </g>

      <g className="loading-background__group--mid-right">
        <polygon className="loading-background__fill--07" points="1440,792 1260,1000 1440,1150" />
        <polygon className="loading-background__fill--05" points="1440,1050 1316,1172 1440,1288" />
      </g>

      <g className="loading-background__group--bottom">
        <polygon points="0,1610 246,1800 0,1998" fill="url(#loading-background-sky-gradient)" />
        <polygon className="loading-background__fill--01" points="0,1768 380,2058 0,2360" />
        <polygon className="loading-background__fill--02" points="112,1710 280,1840 112,1968" />
        <polygon className="loading-background__fill--08" points="0,2032 86,2100 0,2170" />
      </g>

      <g className="loading-background__group--bottom">
        <polygon points="1440,1885 1175,2098 1440,2315" fill="url(#loading-background-sky-gradient)" />
        <polygon className="loading-background__fill--07" points="1440,2110 1240,2276 1440,2432" />
        <polygon className="loading-background__fill--05" points="1260,1900 1364,1982 1260,2060" />
      </g>

      <g className="loading-background__dots">
        <g transform="translate(92 390)">
          <circle cx="0" cy="0" r="7" /><circle cx="40" cy="0" r="7" /><circle cx="80" cy="0" r="7" /><circle cx="120" cy="0" r="7" />
          <circle cx="0" cy="40" r="7" /><circle cx="40" cy="40" r="7" /><circle cx="80" cy="40" r="7" /><circle cx="120" cy="40" r="7" />
          <circle cx="0" cy="80" r="7" /><circle cx="40" cy="80" r="7" /><circle cx="80" cy="80" r="7" /><circle cx="120" cy="80" r="7" />
          <circle cx="0" cy="120" r="7" /><circle cx="40" cy="120" r="7" /><circle cx="80" cy="120" r="7" /><circle cx="120" cy="120" r="7" />
        </g>
        <g transform="translate(1300 210)">
          <circle cx="0" cy="0" r="7" /><circle cx="40" cy="0" r="7" /><circle cx="80" cy="0" r="7" />
          <circle cx="0" cy="40" r="7" /><circle cx="40" cy="40" r="7" /><circle cx="80" cy="40" r="7" />
          <circle cx="0" cy="80" r="7" /><circle cx="40" cy="80" r="7" /><circle cx="80" cy="80" r="7" />
          <circle cx="0" cy="120" r="7" /><circle cx="40" cy="120" r="7" /><circle cx="80" cy="120" r="7" />
        </g>
        <g transform="translate(1296 1748)">
          <circle cx="0" cy="0" r="7" /><circle cx="40" cy="0" r="7" /><circle cx="80" cy="0" r="7" />
          <circle cx="0" cy="40" r="7" /><circle cx="40" cy="40" r="7" /><circle cx="80" cy="40" r="7" />
          <circle cx="0" cy="80" r="7" /><circle cx="40" cy="80" r="7" /><circle cx="80" cy="80" r="7" />
        </g>
        <g transform="translate(70 2200)">
          <circle cx="0" cy="0" r="7" /><circle cx="40" cy="0" r="7" /><circle cx="80" cy="0" r="7" />
          <circle cx="0" cy="40" r="7" /><circle cx="40" cy="40" r="7" /><circle cx="80" cy="40" r="7" />
          <circle cx="0" cy="80" r="7" /><circle cx="40" cy="80" r="7" /><circle cx="80" cy="80" r="7" />
        </g>
      </g>
    </svg>
  </div>
}

export default function LoadingScreen({ mode = 'full' }) {
  const Container = mode === 'content' ? 'section' : 'div'
  const ContentContainer = mode === 'content' ? 'div' : 'main'
  const screenClassName = mode === 'content' ? 'loading-screen loading-screen--content' : 'loading-screen'

  return <Container className={screenClassName} aria-label={mode === 'content' ? '読み込み中' : undefined}>
    <LoadingBackground />
    <ContentContainer className="loading-screen__content">
      <div className="loading-screen__emblem-stage">
        <div className="loading-screen__emblem-spin">
          <img className="loading-screen__emblem" src={emblemUrl} width="46" height="46" alt="" aria-hidden="true" />
        </div>
      </div>

      <div className="loading-screen__status" role="status" aria-live="polite" aria-atomic="true">
        <span className="loading-screen__visually-hidden">読み込み中</span>
        <div className="loading-screen__label" aria-hidden="true">
          {loadingCharacters.map((character, index) => <span className="loading-screen__character" key={`${character}-${index}`}>{character}</span>)}
        </div>
      </div>
    </ContentContainer>
  </Container>
}
