import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './components/Icon.jsx'
import {
  ACCOUNT_CANDIDATES,
  ACCOUNT_HISTORY,
  COMMENT_KINDS,
  COMMENTS,
  KEYWORD_CANDIDATES,
  TITLES,
} from './data.js'

const navItems = [
  { id: 'home', label: 'ホーム', sub: 'サービス概要 / ナビ', icon: 'home', group: 'Home' },
  { id: 'overview', label: '集計・現状・推移', sub: '総評 / AI推奨対応', icon: 'dashboard', group: 'Analyze' },
  { id: 'comments', label: 'コメント一覧', sub: '6分類コメント', icon: 'comment', group: 'Action' },
  { id: 'keywords', label: 'フィルター候補', sub: 'キーワード審査', icon: 'filter', group: 'Action' },
  { id: 'accounts', label: 'ブロック候補', sub: 'アカウント審査', icon: 'block', group: 'Action' },
]

const tone = {
  blue: {
    pill: 'bg-[#EAF8FF] text-[#228FC9]',
    tab: 'bg-[#EAF9FF] border-[#8DD9F8] text-[#2398D3]',
    avatar: 'bg-gradient-to-br from-[#E4F8FF] to-[#C8ECFB] text-[#258FC4]',
  },
  green: {
    pill: 'bg-[#EEFBF6] text-[#2E9D78]',
    tab: 'bg-[#EEFBF6] border-[#BDECD9] text-[#2E9D78]',
    avatar: 'bg-[#EEFBF6] text-[#2E9D78]',
  },
  pink: {
    pill: 'bg-[#FFF0F5] text-[#D94A79]',
    tab: 'bg-[#FFF0F5] border-[#FFC3D5] text-[#D84D78]',
    avatar: 'bg-[#FFF0F5] text-[#D34F77]',
  },
  yellow: {
    pill: 'bg-[#FFF8E5] text-[#A77808]',
    tab: 'bg-[#FFF9E8] border-[#F3DB94] text-[#B78608]',
    avatar: 'bg-[#FFF9E8] text-[#B78608]',
  },
  purple: {
    pill: 'bg-[#F3EFFF] text-[#7060A3]',
    tab: 'bg-[#F4F0FF] border-[#DCCFFC] text-[#7764A8]',
    avatar: 'bg-[#F3EFFF] text-[#7461A4]',
  },
  cyan: {
    pill: 'bg-[#ECFBFC] text-[#258F96]',
    tab: 'bg-[#ECFBFC] border-[#B9EDEF] text-[#258F96]',
    avatar: 'bg-[#ECFBFC] text-[#258F96]',
  },
}

const card = 'rounded-[20px] border border-line bg-white/95 shadow-soft'
const btnBase = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-[15px] text-[11px] font-black transition hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0'

function Brand({ compact = false }) {
  if (compact) {
    return (
      <div className="flex items-center gap-[9px]" aria-label="Optimicom">
        <div className="relative grid h-[34px] w-[34px] place-items-center overflow-hidden rounded-xl bg-[linear-gradient(145deg,#4EC8F7,#2BB1EA_55%,#FF5F98)] text-[13px] font-black tracking-[-.08em] text-white shadow-[0_7px_16px_rgba(46,173,229,.22)] after:absolute after:left-[5px] after:top-[3px] after:h-2 after:w-[23px] after:rounded-[50%] after:bg-white/30 after:content-['']">
          O+
        </div>
        <div className="whitespace-nowrap text-[17px] font-black leading-none tracking-[-.045em] text-ink">Optimi<span className="text-pink">com</span></div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-3 px-2 pb-[10px] pt-1">
        <div className="relative grid h-12 w-12 place-items-center overflow-hidden rounded-[17px] bg-[linear-gradient(145deg,#4EC8F7,#2BB1EA_55%,#FF5F98)] text-lg font-black tracking-[-.08em] text-white shadow-[0_10px_24px_rgba(46,173,229,.24)] after:absolute after:left-2 after:top-1 after:h-3 after:w-8 after:rounded-[50%] after:bg-white/30 after:content-['']">O+</div>
        <div>
          <strong className="block text-lg font-black tracking-[-.045em]">Optimi<span className="text-pink">com</span></strong>
          <small className="mt-0.5 block text-[9px] font-black tracking-[.08em] text-[#7A91AE]">オプティミコム</small>
        </div>
      </div>
      <div className="mx-2 inline-flex items-center gap-1.5 rounded-full border border-[#CDEAF7] bg-gradient-to-b from-[#F8FEFF] to-[#EAF9FF] px-2.5 py-2 text-[9px] font-black uppercase tracking-[.12em] text-[#2A8FC4] before:text-pink before:content-['✦']">
        comment care console
      </div>
    </div>
  )
}

function Sidebar({ screen, onChange }) {
  const groups = ['Home', 'Analyze', 'Action']
  return (
    <aside className="sticky top-0 z-30 flex h-screen w-[252px] shrink-0 flex-col gap-6 border-r border-line bg-white/85 px-4 pb-[18px] pt-[22px] backdrop-blur-[20px] max-[1180px]:w-[220px] max-[820px]:hidden">
      <Brand />
      {groups.map((group) => (
        <div key={group}>
          <div className="px-2.5 text-[9px] font-black uppercase tracking-[.14em] text-[#9AABC0]">{group}</div>
          <nav className="mt-1.5 grid gap-1.5">
            {navItems.filter((item) => item.group === group).map((item) => {
              const active = screen === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onChange(item.id)}
                  className={`flex w-full items-center gap-[11px] rounded-[14px] border-0 p-3 text-left font-black transition ${active ? 'bg-gradient-to-r from-[#E8F9FF] to-[#F7FDFF] text-[#1E9DDD] shadow-[inset_0_0_0_1px_#CDEBF8]' : 'bg-transparent text-[#617593] hover:bg-[#F0FAFF] hover:text-[#239DDA]'}`}
                >
                  <span className={`grid h-[34px] w-[34px] shrink-0 place-items-center rounded-xl ${active ? 'bg-gradient-to-br from-sky to-[#2EB0E9] text-white shadow-[0_7px_14px_rgba(48,175,231,.22)]' : 'bg-[#F2F7FB] text-[#7B90AA]'}`}>
                    <Icon name={item.icon} />
                  </span>
                  <span className="min-w-0">
                    {item.label}
                    <small className="mt-0.5 block text-[9px] font-bold text-[#A3B0C1]">{item.sub}</small>
                  </span>
                </button>
              )
            })}
          </nav>
        </div>
      ))}
      <div className="mt-auto border-t border-line px-2.5 pb-1 pt-3.5 text-[10px] text-[#98A7BA]">
        <b className="mb-1 block text-[#5E7594]">Optimicom</b>
        コメント欄最適化プラットフォーム<br />UI concept demo / sample data
      </div>
    </aside>
  )
}

function Header({ screen, onChange }) {
  const [title, subtitle] = TITLES[screen]
  const [updatedAt, setUpdatedAt] = useState('')

  useEffect(() => {
    const now = new Date()
    const parts = new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now)
    const v = Object.fromEntries(parts.map((x) => [x.type, x.value]))
    setUpdatedAt(`${v.year}/${v.month}/${v.day} ${v.hour}:${v.minute}`)
  }, [])

  return (
    <div className="sticky top-0 z-20">
      <header className="flex h-[72px] items-center justify-between gap-4 border-b border-[rgba(220,234,244,.92)] bg-[rgba(250,253,255,.90)] px-7 backdrop-blur-[18px] max-[820px]:h-16 max-[820px]:px-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {screen !== 'home' && (
            <button type="button" onClick={() => onChange('home')} aria-label="ホームへ戻る" className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-xl border border-line bg-white text-[#5A7594] shadow-[0_4px_12px_rgba(63,101,143,.05)]">
              <Icon name="back" strokeWidth={2} />
            </button>
          )}
          <div className="min-w-0">
            {screen === 'home' && <div className="hidden max-[820px]:flex"><Brand compact /></div>}
            <strong className={`block truncate text-lg font-black leading-[1.1] tracking-[-.025em] max-[820px]:text-base ${screen === 'home' ? 'max-[820px]:hidden' : ''}`}>{title}</strong>
            <span className={`mt-1 block text-[10px] text-[#8A9AB0] max-[820px]:hidden ${screen === 'home' ? 'max-[820px]:hidden' : ''}`}>{subtitle}</span>
          </div>
        </div>
        <div className="flex items-center gap-[9px]">
          <span className="whitespace-nowrap rounded-full border border-[#D7E8F4] bg-gradient-to-b from-white to-[#F3FAFF] px-[11px] py-[7px] text-[10px] font-black text-[#587392] shadow-[0_4px_12px_rgba(59,107,148,.06)] max-[820px]:px-2 max-[820px]:py-1.5 max-[820px]:text-[9px] max-[560px]:max-w-[155px] max-[560px]:overflow-hidden max-[560px]:text-ellipsis">最終集計日時: {updatedAt || '--/-- --:--'}</span>
          <button type="button" aria-label="通知" className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-white text-[#617897] max-[560px]:hidden">
            <Icon name="bell" />
          </button>
        </div>
      </header>
      {screen === 'home' && (
        <nav className="border-b border-line bg-white/95 px-7 py-[9px] shadow-[0_8px_18px_rgba(63,101,143,.04)] max-[820px]:px-3 max-[820px]:py-2" aria-label="ホーム画面ナビゲーション">
          <div className="no-scrollbar flex w-full gap-2 overflow-x-auto px-px pb-1 pt-0.5">
            {navItems.filter((x) => x.id !== 'home').map((item) => (
              <button key={item.id} type="button" onClick={() => onChange(item.id)} className="flex min-w-[170px] flex-1 items-center justify-center gap-2 rounded-[14px] border border-[#D9EAF5] bg-gradient-to-b from-white to-[#F6FBFF] px-3 py-[11px] text-[10px] font-black text-[#587391] transition hover:border-[#8ED9F8] hover:bg-gradient-to-b hover:from-white hover:to-[#ECF9FF] hover:text-[#2298D3] hover:shadow-[0_6px_14px_rgba(42,169,229,.10)] max-[820px]:min-w-[150px] max-[820px]:flex-none">
                <Icon name={item.icon} className="h-[17px] w-[17px]" />
                {item.id === 'keywords' ? 'キーワード候補' : item.id === 'accounts' ? 'アカウント候補' : item.label}
              </button>
            ))}
          </div>
        </nav>
      )}
    </div>
  )
}

function SectionHeader({ title, accent, children, right }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-[18px] max-[820px]:mb-4 max-[820px]:flex-col max-[820px]:items-start">
      <div>
        <h1 className="mb-[7px] mt-0 text-[32px] font-black leading-[1.15] tracking-[-.05em] max-[820px]:text-[27px]">
          {title}<span className="text-pink">{accent}</span>
        </h1>
        <p className="m-0 text-xs text-muted max-[560px]:text-[11px]">{children}</p>
      </div>
      {right}
    </div>
  )
}

function HomeScreen() {
  return (
    <section className="animate-screen">
      <article className="relative overflow-hidden rounded-[28px] border border-[#D9EAF5] bg-[linear-gradient(145deg,#FFFFFF,#F4FCFF_58%,#FFF4F8)] p-[34px] shadow-panel before:absolute before:-right-[14px] before:-top-4 before:whitespace-nowrap before:text-[92px] before:font-black before:tracking-[-.08em] before:text-[rgba(78,200,247,.065)] before:content-['OPTIMICOM'] max-[560px]:p-[24px_18px] max-[560px]:before:text-[58px]">
        <span className="inline-flex items-center gap-[7px] rounded-full bg-[#EAF9FF] px-2.5 py-1.5 text-[9px] font-black tracking-[.12em] text-[#238FC8] before:text-pink before:content-['✦']">COMMENT OPTIMIZATION PLATFORM</span>
        <h1 className="relative my-4 max-w-[760px] text-[clamp(38px,5vw,64px)] font-black leading-[1.02] tracking-[-.065em] max-[560px]:text-[40px]">コメント欄を、<br /><span className="text-pink">もっと健やかに。</span></h1>
        <p className="relative m-0 max-w-[720px] text-sm text-[#657B99]">Optimicom（オプティミコム）は、コメントを6分類で可視化し、AIによる推奨対応、フィルター候補、ブロック候補を整理するコメント欄最適化プラットフォームです。</p>
      </article>
    </section>
  )
}

function Pill({ children, kind = 'blue' }) {
  const styles = {
    blue: 'bg-[#EAF8FF] text-[#228FC9]', pink: 'bg-[#FFF0F5] text-[#D94A79]', yellow: 'bg-[#FFF8E5] text-[#A77808]', green: 'bg-[#EEFCF5] text-[#247A59]', purple: 'bg-[#F3EFFF] text-[#7060A3]', cyan: 'bg-[#ECFBFC] text-[#258F96]',
  }
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-[5px] text-[9px] font-black whitespace-nowrap ${styles[kind]}`}>{children}</span>
}

function OverviewScreen({ notify }) {
  const [period, setPeriod] = useState('7日間')
  const choose = (next) => { setPeriod(next); notify(`${next}の集計に切り替えました。`) }

  return (
    <section className="animate-screen">
      <SectionHeader
        title="コメント欄の"
        accent="いま"
        right={<div className="flex flex-wrap gap-[7px] max-[560px]:w-full">{['24時間', '7日間', '30日間'].map((x) => <button type="button" key={x} onClick={() => choose(x)} className={`rounded-full border px-3 py-2 text-[10px] font-black max-[560px]:flex-1 ${period === x ? 'border-[#8ED9F8] bg-[#EAF9FF] text-[#2298D3]' : 'border-line bg-white text-[#607592] hover:border-[#8ED9F8] hover:bg-[#EAF9FF] hover:text-[#2298D3]'}`}>{x}</button>)}</div>}
      >肯定的・中庸的・批判的・対批判・迷惑・対迷惑の6分類と日次推移をまとめて確認できます。</SectionHeader>

      <div className="grid grid-cols-[320px_minmax(0,1fr)] gap-4 max-[1180px]:grid-cols-[280px_1fr] max-[820px]:grid-cols-1">
        <article className={`${card} relative overflow-hidden bg-[linear-gradient(155deg,#FFFFFF_0,#F7FDFF_60%,#FFF7FA_100%)] p-[22px] after:absolute after:-right-20 after:-top-[70px] after:h-40 after:w-40 after:rounded-full after:bg-[radial-gradient(circle,#FFD4E2_0,rgba(255,212,226,0)_70%)]`}>
          <div className="relative z-10 flex items-center justify-between gap-2.5 text-[11px] font-black text-[#6B809D]"><span>OPTIMICOM SCORE</span><Pill>GOOD</Pill></div>
          <div className="relative z-10 mt-3.5 flex items-end gap-2"><strong className="text-[72px] font-black leading-[.9] tracking-[-.07em] text-[#1F4A7E] max-[820px]:text-[60px]">82</strong><span className="pb-[7px] text-base font-black text-[#8494A9]">/ 100</span></div>
          <div className="relative z-10 mt-[18px] h-2.5 overflow-hidden rounded-full bg-[#E8F2F8]"><i className="block h-full w-[82%] rounded-[inherit] bg-gradient-to-r from-sky via-cyan to-pink" /></div>
          <div className="relative z-10 mt-3.5 rounded-[14px] border border-[#E5EEF6] bg-[#F7FBFE] p-3 text-[11px] text-[#627794]"><b className="text-[#2C6DA1]">総評：</b>全体として健全です。批判的コメントが前週比で微増しています。対批判の反応も含め、該当話題の会話全体を重点確認することを推奨します。</div>
        </article>
        <div className="grid gap-3.5">
          <article className={`${card} relative flex min-h-[138px] flex-col justify-center overflow-hidden p-[18px] before:absolute before:-right-[26px] before:-top-7 before:h-20 before:w-20 before:rounded-full before:bg-[rgba(78,200,247,.10)]`}>
            <div className="text-[10px] font-black text-[#7689A3]">総コメント数</div>
            <div className="my-[13px] text-[54px] font-black leading-[.92] tracking-[-.055em] text-[#234D7E] max-[820px]:text-[46px]">18,420</div>
            <div className="text-[10px] text-[#92A0B2]"><b className="text-good">+8.4%</b> 前週比</div>
          </article>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_1.4fr] gap-4 max-[1180px]:grid-cols-1">
        <article className={`${card} p-5`}>
          <div className="mb-[18px] flex items-start justify-between gap-3"><div><h2 className="m-0 text-[15px] font-bold tracking-[-.02em]">集計チャート</h2><p className="mt-[3px] text-[10px] text-muted">コメント感情の構成比</p></div><Pill>7 DAYS</Pill></div>
          <div className="grid grid-cols-[170px_1fr] items-center gap-4 max-[820px]:grid-cols-[140px_1fr] max-[560px]:grid-cols-1">
            <div className="relative mx-auto grid h-40 w-40 place-items-center rounded-full bg-[conic-gradient(#4EC8F7_0_48%,#8EE6C2_48%_69%,#FF5F98_69%_84%,#FFD76A_84%_90%,#D8CBFF_90%_97%,#6BE2E5_97%_100%)] after:h-[92px] after:w-[92px] after:rounded-full after:bg-white after:shadow-[0_0_0_1px_#E4EEF5] after:content-[''] max-[820px]:h-[132px] max-[820px]:w-[132px] max-[820px]:after:h-[76px] max-[820px]:after:w-[76px]">
              <div className="absolute z-10 text-center"><b className="text-2xl">18.4K</b><span className="block text-[9px] font-black text-[#8A99AD]">COMMENTS</span></div>
            </div>
            <div className="grid gap-[11px] max-[560px]:grid-cols-2">
              {[
                ['#4EC8F7', '肯定的', '48%'], ['#8EE6C2', '中庸的', '21%'], ['#FF5F98', '批判的', '15%'], ['#FFD76A', '対批判', '6%'], ['#D8CBFF', '迷惑', '7%'], ['#6BE2E5', '対迷惑', '3%'],
              ].map(([color, label, value]) => (
                <div key={label} className="grid grid-cols-[12px_1fr_auto] items-center gap-[9px]"><i className="h-2.5 w-2.5 rounded" style={{ background: color }} /><span className="text-[11px] font-black text-[#5C718E]">{label}</span><b className="text-xs">{value}</b></div>
              ))}
            </div>
          </div>
        </article>

        <article className={`${card} p-5`}>
          <div className="mb-[18px] flex items-start justify-between gap-3"><div><h2 className="m-0 text-[15px] font-bold tracking-[-.02em]">推移チャート</h2><p className="mt-[3px] text-[10px] text-muted">日毎の6分類推移</p></div></div>
          <div className="h-[255px] overflow-hidden rounded-2xl border border-[#E7F0F6] bg-gradient-to-b from-[#FBFEFF] to-[#F7FBFE] p-3 max-[560px]:h-[220px]">
            <TrendChart />
          </div>
          <div className="mt-[11px] flex flex-wrap gap-3.5">
            {[
              ['#4EC8F7', '肯定的'], ['#8EE6C2', '中庸的'], ['#FF5F98', '批判的'], ['#FFD76A', '対批判'], ['#D8CBFF', '迷惑'], ['#6BE2E5', '対迷惑'],
            ].map(([color, label]) => <span key={label} className="text-[10px] font-black text-[#6E829E]"><i className="mr-1.5 inline-block h-1 w-2.5 rounded-full align-middle" style={{ background: color }} />{label}</span>)}
          </div>
        </article>
      </div>

      <article className="relative mt-4 overflow-hidden rounded-[22px] border border-[#D9EBF6] bg-[linear-gradient(145deg,#F7FDFF,#FFFFFF_50%,#FFF8FB)] p-[22px] shadow-soft before:absolute before:right-[18px] before:-top-0.5 before:text-[76px] before:font-black before:leading-none before:text-[rgba(78,200,247,.08)] before:content-['AI']">
        <div className="relative flex items-center gap-2.5"><div className="grid h-[42px] w-[42px] place-items-center rounded-[14px] bg-gradient-to-br from-sky to-pink text-white"><Icon name="spark" className="h-[22px] w-[22px]" /></div><div><h2 className="m-0 text-base font-bold">AI 推奨対応</h2><p className="mt-0.5 text-[10px] text-[#8595AA]">過去7日間の傾向から、優先すべき対応を提案します。</p></div></div>
        <div className="relative mt-[18px] grid grid-cols-3 gap-3 max-[1180px]:grid-cols-2 max-[1180px]:[&>*:last-child]:col-span-2 max-[820px]:grid-cols-1 max-[820px]:[&>*:last-child]:col-span-1">
          <Recommendation priority="PRIORITY A" tone="high" title="特定話題の批判的コメント増加を確認">昨日から同一テーマの批判的コメントが増加。対批判も合わせて優先レビュー。</Recommendation>
          <Recommendation priority="PRIORITY B" tone="mid" title="新規フィルター候補を3件確認">迷惑コメントとの共起が高い表現を候補化しています。</Recommendation>
          <Recommendation priority="PRIORITY C" tone="low" title="肯定的コメントへの反応を促進">反応率の高い肯定的コメントを上部表示すると会話品質が改善する見込み。</Recommendation>
        </div>
      </article>
    </section>
  )
}

function Recommendation({ priority, tone: level, title, children }) {
  const style = level === 'high' ? 'border-[#FFD3DF] [&>small]:text-[#D74F74]' : level === 'mid' ? 'border-[#FFE8AF] [&>small]:text-[#A7790B]' : 'border-[#CFEAF7] [&>small]:text-[#278EBD]'
  return <div className={`rounded-2xl border bg-white p-3.5 ${style}`}><small className="mb-1.5 block text-[9px] font-black">{priority}</small><b className="block text-xs">{title}</b><p className="mb-0 mt-1.5 text-[10px] text-[#7588A2]">{children}</p></div>
}

function TrendChart() {
  return (
    <svg viewBox="0 0 720 230" className="h-full w-full">
      <defs><linearGradient id="posGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4EC8F7" stopOpacity=".24"/><stop offset="1" stopColor="#4EC8F7" stopOpacity="0"/></linearGradient></defs>
      {[25, 75, 125, 175].map((y) => <line key={y} x1="50" y1={y} x2="700" y2={y} stroke="#E4EEF5" strokeWidth="1" />)}
      {[[8,29,'3,000'],[8,79,'2,000'],[8,129,'1,000'],[26,179,'0']].map(([x,y,t]) => <text key={t} x={x} y={y} fill="#95A3B5" fontSize="10">{t}</text>)}
      <path fill="url(#posGrad)" d="M60,78 L160,72 L260,65 L360,70 L460,58 L560,49 L660,55 L660,175 L60,175 Z"/>
      <polyline fill="none" stroke="#43BFEF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points="60,78 160,72 260,65 360,70 460,58 560,49 660,55"/>
      <polyline fill="none" stroke="#63CFA6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points="60,118 160,116 260,112 360,114 460,108 560,105 660,109"/>
      <polyline fill="none" stroke="#FF6A9B" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points="60,139 160,136 260,132 360,125 460,121 560,116 660,112"/>
      <polyline fill="none" stroke="#E7B73E" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" points="60,156 160,155 260,151 360,149 460,145 560,141 660,143"/>
      <polyline fill="none" stroke="#A995C5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points="60,161 160,159 260,157 360,158 460,153 560,151 660,154"/>
      <polyline fill="none" stroke="#47C8CC" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" points="60,169 160,168 260,166 360,165 460,163 560,161 660,162"/>
      {[[54,'9/6'],[151,'9/7'],[251,'9/8'],[351,'9/9'],[447,'9/10'],[548,'9/11'],[648,'9/12']].map(([x,t]) => <text key={t} x={x} y="205" fill="#95A3B5" fontSize="10">{t}</text>)}
    </svg>
  )
}

function CommentsScreen() {
  const [kind, setKind] = useState('positive')
  const [query, setQuery] = useState('')
  const kindInfo = Object.fromEntries(COMMENT_KINDS.map((x) => [x.id, x]))
  const visible = useMemo(() => COMMENTS.filter((item) => item.kind === kind && (!query.trim() || `${item.user} ${item.text}`.toLowerCase().includes(query.trim().toLowerCase()))).sort((a, b) => b.order - a.order), [kind, query])

  return (
    <section className="animate-screen">
      <SectionHeader title="コメント" accent="一覧">肯定的・中庸的・批判的・対批判・迷惑・対迷惑の6分類でコメントを確認します。</SectionHeader>
      <div className="mb-4 flex flex-wrap gap-2">
        {COMMENT_KINDS.map((item) => <button key={item.id} type="button" onClick={() => setKind(item.id)} className={`rounded-full border px-[13px] py-[9px] text-[10px] font-black ${kind === item.id ? tone[item.tone].tab : 'border-line bg-white text-[#637896]'}`}>{item.label} {item.count.toLocaleString()}</button>)}
      </div>
      <div className="mb-3.5 flex flex-wrap items-center gap-[9px] max-[560px]:items-stretch">
        <input value={query} onChange={(e) => setQuery(e.target.value)} className="h-[42px] min-w-[260px] max-w-[420px] flex-1 rounded-[13px] border border-line bg-white px-[13px] text-ink outline-0 focus:border-[#72CCF4] focus:shadow-[0_0_0_4px_rgba(78,200,247,.12)] max-[560px]:min-w-full max-[560px]:max-w-none max-[560px]:text-base" placeholder="コメント・ユーザー名を検索" />
        <select className="h-[42px] rounded-[13px] border border-line bg-white px-3 text-[#586E8D] outline-0 max-[560px]:flex-1 max-[560px]:text-base"><option>新しい順</option></select>
      </div>
      <div className="grid gap-2.5">
        {visible.map((item) => {
          const info = kindInfo[item.kind]
          return (
            <article key={`${item.kind}-${item.user}`} className={`${card} grid grid-cols-[auto_1fr_auto] items-start gap-[13px] p-4 max-[820px]:grid-cols-[auto_1fr] max-[560px]:gap-[11px] max-[560px]:p-3.5`}>
              <div className={`grid h-[42px] w-[42px] place-items-center rounded-[14px] font-black ${tone[info.tone].avatar}`}>{item.avatar}</div>
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="text-xs">{item.user}</strong><span className={`rounded-full px-2 py-[5px] text-[9px] font-black ${tone[info.tone].pill}`}>{info.label}</span></div><div className="mt-[7px] text-xs text-[#536985]">{item.text}</div></div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

async function copyText(value) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch { /* fallback below */ }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    textarea.remove()
    return ok
  } catch { return false }
}

function KeywordScreen({ notify }) {
  const [query, setQuery] = useState('')
  const [risk, setRisk] = useState('all')
  const [newOnly, setNewOnly] = useState(false)
  const [marked, setMarked] = useState(() => new Set())
  const [expanded, setExpanded] = useState(() => new Set())

  const visible = KEYWORD_CANDIDATES.filter((item) => (!query.trim() || `${item.keyword} ${item.meta.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())) && (risk === 'all' || item.risk === risk) && (!newOnly || item.isNew))
  const toggleMarked = async (item) => {
    if (marked.has(item.id)) {
      setMarked((prev) => { const next = new Set(prev); next.delete(item.id); return next })
      notify('追加済みマークを解除しました。')
      return
    }
    const ok = await copyText(item.keyword)
    if (!ok) return notify('コピーできませんでした。')
    setMarked((prev) => new Set(prev).add(item.id))
    notify(`${item.keyword} をコピーしました。`)
  }

  return (
    <section className="animate-screen">
      <SectionHeader title="フィルターキーワード" accent="候補" right={<Pill kind="yellow">12 候補</Pill>}>AIが共起率・反復率・迷惑判定との相関から抽出した候補です。コピーすると追加済みとしてマークできます。</SectionHeader>
      <div className="mb-3.5 flex flex-wrap items-center gap-[9px] max-[560px]:items-stretch">
        <input value={query} onChange={(e) => setQuery(e.target.value)} className="h-[42px] min-w-[260px] max-w-[420px] flex-1 rounded-[13px] border border-line bg-white px-[13px] outline-0 focus:border-[#72CCF4] focus:shadow-[0_0_0_4px_rgba(78,200,247,.12)] max-[560px]:min-w-full max-[560px]:max-w-none max-[560px]:text-base" placeholder="キーワードを検索" />
        <select value={risk} onChange={(e) => setRisk(e.target.value)} className="h-[42px] rounded-[13px] border border-line bg-white px-3 text-[#586E8D] outline-0 max-[560px]:flex-1 max-[560px]:text-base"><option value="all">全リスク</option><option value="high">高リスク</option><option value="mid">中リスク</option></select>
        <label className={`inline-flex h-[42px] cursor-pointer items-center gap-[7px] whitespace-nowrap rounded-[13px] border px-3 text-[10px] font-black ${newOnly ? 'border-[#8DD9F8] bg-[#EAF9FF] text-[#2398D3]' : 'border-line bg-white text-[#586E8D]'}`}><input type="checkbox" checked={newOnly} onChange={(e) => setNewOnly(e.target.checked)} className="m-0 h-4 w-4 accent-[#229CDE]" /> <span>newのみ</span></label>
      </div>
      <div className="grid gap-3">
        {visible.map((item) => {
          const isMarked = marked.has(item.id)
          const isExpanded = expanded.has(item.id)
          return (
            <article key={item.id} className={`${card} grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3.5 p-4 max-[560px]:grid-cols-1 ${isMarked ? 'border-[#D5DEE8] bg-[linear-gradient(145deg,#FFFFFF,#F7F9FB_72%,#F3F6F8)] shadow-[0_0_0_3px_rgba(91,107,126,.06),0_8px_24px_rgba(63,101,143,.09)]' : ''}`}>
              <div>
                <div className="flex flex-wrap items-center gap-2"><code className="rounded-lg border border-[#E1EBF3] bg-[#F0F6FA] px-1.5 py-[3px] text-[11px] text-[#385777]">{item.keyword}</code><Pill kind={item.risk === 'high' ? 'pink' : 'yellow'}>{item.riskLabel}</Pill></div>
                <div className="mt-2 flex flex-wrap gap-[13px] text-[10px] text-[#8392A7]">{item.meta.map((x) => <span key={x}>{x}</span>)}</div>
                <button type="button" aria-expanded={isExpanded} onClick={() => setExpanded((prev) => { const next = new Set(prev); isExpanded ? next.delete(item.id) : next.add(item.id); return next })} className="mt-2.5 inline-flex items-center gap-1.5 border-0 bg-transparent px-0 py-1 text-[10px] font-black text-[#4E6C8D] hover:text-[#229CDE]">詳細<span className={`text-xs transition ${isExpanded ? 'rotate-180' : ''}`}>⌄</span></button>
                {isExpanded && <div className="mt-1.5 rounded-xl border border-[#E7EFF5] bg-[#F8FBFE] px-3 py-[11px] text-[10px] text-[#5D7390]"><b className="mb-[3px] block text-[9px] text-[#385777]">候補理由</b><span className="block leading-[1.65]">{item.reason}</span></div>}
                {isMarked && <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#F1F4F7] px-2 py-1 text-[9px] font-black text-[#758396]">✓ 追加済みとしてマーク</span>}
              </div>
              <div className="flex flex-wrap justify-end gap-[7px] max-[560px]:col-span-full max-[560px]:justify-stretch [&>button]:max-[560px]:flex-1">
                <button type="button" onClick={() => toggleMarked(item)} className={`${btnBase} min-w-[94px] ${isMarked ? 'border border-[#D3DCE5] bg-[#F1F4F7] text-[#6F7E91]' : 'bg-gradient-to-b from-[#57CBF9] to-[#2AA9E5] text-white shadow-[0_8px_18px_rgba(42,169,229,.18)]'}`}>{isMarked ? '✓ 追加済み' : '⧉ コピー'}</button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function AccountsScreen({ notify, onProfile }) {
  const [query, setQuery] = useState('')
  const [risk, setRisk] = useState('all')
  const [marked, setMarked] = useState(() => new Set())
  const visible = ACCOUNT_CANDIDATES.filter((item) => (!query.trim() || item.user.toLowerCase().includes(query.trim().toLowerCase())) && (risk === 'all' || item.risk === risk))

  const toggleMarked = async (item) => {
    if (marked.has(item.id)) {
      setMarked((prev) => { const next = new Set(prev); next.delete(item.id); return next })
      notify('ブロック済みマークを解除しました。')
      return
    }
    const ok = await copyText(item.user)
    if (!ok) return notify('コピーできませんでした。')
    setMarked((prev) => new Set(prev).add(item.id))
    notify(`${item.user} をコピーしました。`)
  }

  return (
    <section className="animate-screen">
      <SectionHeader title="ブロックアカウント" accent="候補" right={<Pill kind="pink">8 候補</Pill>}>投稿頻度、迷惑判定率、通報数、外部誘導の反復から候補を提示します。コピーするとブロック済みとしてマークできます。</SectionHeader>
      <div className="mb-3.5 flex flex-wrap items-center gap-[9px] max-[560px]:items-stretch">
        <input value={query} onChange={(e) => setQuery(e.target.value)} className="h-[42px] min-w-[260px] max-w-[420px] flex-1 rounded-[13px] border border-line bg-white px-[13px] outline-0 focus:border-[#72CCF4] focus:shadow-[0_0_0_4px_rgba(78,200,247,.12)] max-[560px]:min-w-full max-[560px]:max-w-none max-[560px]:text-base" placeholder="アカウント名を検索" />
        <select value={risk} onChange={(e) => setRisk(e.target.value)} className="h-[42px] rounded-[13px] border border-line bg-white px-3 text-[#586E8D] outline-0 max-[560px]:flex-1 max-[560px]:text-base"><option value="all">全リスク</option><option value="high">高リスク</option><option value="mid">中リスク</option></select>
      </div>
      <div className="grid gap-3">
        {visible.map((item) => {
          const isMarked = marked.has(item.id)
          return (
            <article key={item.id} className={`${card} grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3.5 p-4 max-[560px]:grid-cols-1 ${isMarked ? 'border-[#D5DEE8] bg-[linear-gradient(145deg,#FFFFFF,#F7F9FB_72%,#F3F6F8)] shadow-[0_0_0_3px_rgba(91,107,126,.06),0_8px_24px_rgba(63,101,143,.09)]' : ''}`}>
              <div>
                <div className="flex items-center gap-3"><div className="grid h-[46px] w-[46px] place-items-center rounded-full bg-[linear-gradient(145deg,#E0F7FF,#C8EAF9_58%,#FFDDEA)] font-black text-[#2D79A8]">{item.avatar}</div><div><strong className="text-[13px]">{item.user}</strong></div><Pill kind={item.risk === 'high' ? 'pink' : 'yellow'}>{item.riskLabel}</Pill></div>
                <div className="mt-2 text-[10px] text-[#8090A6]">迷惑コメント数 <b className="text-[#355C88]">{item.nuisanceCount}件</b></div>
                {isMarked && <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#F1F4F7] px-2 py-1 text-[9px] font-black text-[#758396]">✓ ブロック済みとしてマーク</span>}
              </div>
              <div className="flex flex-wrap justify-end gap-[7px] max-[560px]:col-span-full max-[560px]:justify-stretch [&>button]:max-[560px]:min-h-11 [&>button]:max-[560px]:flex-1">
                <button type="button" onClick={() => onProfile(item)} className={`${btnBase} border border-line bg-white text-[#5D7390]`}>履歴確認</button>
                <button type="button" onClick={() => toggleMarked(item)} className={`${btnBase} min-w-[94px] ${isMarked ? 'border border-[#D3DCE5] bg-[#F1F4F7] text-[#6F7E91]' : 'bg-gradient-to-b from-[#57CBF9] to-[#2AA9E5] text-white shadow-[0_8px_18px_rgba(42,169,229,.18)]'}`}>{isMarked ? '✓ ブロック済み' : '⧉ コピー'}</button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function AccountModal({ account, onClose }) {
  const closeRef = useRef(null)
  const items = account ? ACCOUNT_HISTORY[account.id] ?? [] : []

  useEffect(() => {
    if (!account) return
    const handler = (event) => event.key === 'Escape' && onClose()
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handler)
    closeRef.current?.focus()
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', handler)
    }
  }, [account, onClose])

  if (!account) return null
  return (
    <div onMouseDown={(e) => e.target === e.currentTarget && onClose()} className="fixed inset-0 z-[120] flex items-center justify-center bg-[rgba(24,49,83,.34)] p-6 backdrop-blur-lg max-[560px]:p-2.5" aria-hidden="false">
      <section role="dialog" aria-modal="true" aria-labelledby="modalAccountName" className="fixed left-1/2 top-1/2 flex max-h-[min(78dvh,760px)] w-[min(620px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-3xl border border-[rgba(207,228,242,.96)] bg-gradient-to-b from-white to-[#FAFDFF] shadow-[0_30px_80px_rgba(32,64,101,.24),0_8px_24px_rgba(32,64,101,.12)] max-[560px]:max-h-[82dvh] max-[560px]:w-[calc(100vw-20px)] max-[560px]:rounded-[22px]">
        <div className="relative flex items-center justify-between gap-4 border-b border-[#E3EEF6] bg-[linear-gradient(145deg,#FFFFFF_0%,#F5FCFF_64%,#FFF7FA_100%)] px-5 pb-[17px] pt-5 max-[560px]:px-[15px] max-[560px]:pb-[13px] max-[560px]:pt-4">
          <div className="flex min-w-0 items-center gap-[13px]"><div className="grid h-[50px] w-[50px] shrink-0 place-items-center rounded-2xl bg-[linear-gradient(145deg,#DFF7FF_0%,#CBEFFB_58%,#FFE0EA_100%)] text-[17px] font-black text-[#277FAE] shadow-[inset_0_0_0_1px_rgba(85,184,226,.14),0_7px_16px_rgba(52,143,184,.12)] max-[560px]:h-[42px] max-[560px]:w-[42px]">{account.avatar}</div><div className="min-w-0"><h2 id="modalAccountName" className="m-0 truncate text-lg font-bold leading-[1.2] tracking-[-.025em] text-[#244A78] max-[560px]:text-base">{account.user}</h2><p className="mt-1 text-[10px] font-black tracking-[.02em] text-[#8A9AB0]">投稿迷惑コメント履歴</p></div></div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="閉じる" className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-xl border border-line bg-white/90 text-2xl leading-none text-[#72859E] shadow-[0_4px_12px_rgba(63,101,143,.06)] transition hover:-translate-y-px hover:border-[#FFC5D6] hover:bg-[#FFF6F9] hover:text-[#D84E7A]">×</button>
        </div>
        <div className="min-h-0 overflow-auto bg-gradient-to-b from-[#FCFEFF] to-[#F8FCFF] px-5 pb-[22px] pt-[18px] max-[560px]:px-[15px] max-[560px]:pb-[18px] max-[560px]:pt-3.5">
          <div className="mx-0.5 mb-[11px] flex items-center justify-between gap-3"><strong className="text-[11px] text-[#4E6787]">投稿迷惑コメントリスト</strong><span className="inline-flex h-[25px] min-w-[42px] items-center justify-center rounded-full border border-[#FFD3DE] bg-[#FFF0F5] px-[9px] text-[9px] font-black text-[#D34F77]">{items.length}件</span></div>
          <div className="grid gap-[9px]">
            {items.length ? items.map((item) => <article key={`${item.date}-${item.text}`} className="relative rounded-[15px] border border-[#E2EDF5] bg-white py-3 pl-4 pr-3.5 shadow-[0_5px_16px_rgba(63,101,143,.055)] before:absolute before:bottom-3 before:left-0 before:top-3 before:w-[3px] before:rounded-r-[3px] before:bg-gradient-to-b before:from-[#57CBF9] before:to-[#2AA9E5] before:content-['']"><p className="m-0 break-words text-[11px] leading-[1.7] text-[#4F6583]">{item.text}</p><small className="mt-2 block text-[9px] font-black text-[#99A7B8]">{item.date}</small></article>) : <div className="rounded-[15px] border border-dashed border-[#D8E7F2] bg-[#FBFDFF] px-4 py-[26px] text-center text-[11px] text-[#8A9AB0]">表示できる迷惑コメントはありません。</div>}
          </div>
        </div>
      </section>
    </div>
  )
}

function MobileNav({ screen, onChange }) {
  const items = [
    ['home', 'ホーム', 'home'], ['overview', '集計', 'dashboard'], ['comments', 'コメント', 'comment'], ['keywords', 'KW候補', 'filter'], ['accounts', '垢候補', 'block'],
  ]
  return (
    <nav className="fixed bottom-[max(14px,env(safe-area-inset-bottom))] left-2.5 right-2.5 z-50 hidden rounded-[20px] border border-[#D8E8F3] bg-white/95 p-1.5 shadow-[0_16px_34px_rgba(44,83,122,.18)] backdrop-blur-[18px] max-[820px]:flex" aria-label="フッターナビゲーション">
      {items.map(([id, label, icon]) => <button key={id} type="button" onClick={() => onChange(id)} className={`grid flex-1 place-items-center gap-0.5 rounded-[14px] border-0 bg-transparent px-0.5 py-[7px] text-[8px] font-black max-[560px]:text-[7px] ${screen === id ? 'bg-[#EAF9FF] text-[#229ADD]' : 'text-[#73869F]'}`}><Icon name={icon} className="h-[19px] w-[19px]" />{label}</button>)}
    </nav>
  )
}

export default function App() {
  const [screen, setScreen] = useState('home')
  const [toast, setToast] = useState('')
  const [accountModal, setAccountModal] = useState(null)
  const toastTimer = useRef(null)

  const changeScreen = (name) => {
    setScreen(name)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const notify = (message) => {
    setToast(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 1800)
  }

  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  return (
    <div className="min-h-screen text-sm leading-[1.55] text-ink">
      <div className="flex min-h-screen max-[820px]:block">
        <Sidebar screen={screen} onChange={changeScreen} />
        <main className="min-w-0 flex-1">
          <Header screen={screen} onChange={changeScreen} />
          <div className="p-7 max-[820px]:px-3.5 max-[820px]:pb-[calc(96px+max(14px,env(safe-area-inset-bottom)))] max-[820px]:pt-4">
            {screen === 'home' && <HomeScreen />}
            {screen === 'overview' && <OverviewScreen notify={notify} />}
            {screen === 'comments' && <CommentsScreen />}
            {screen === 'keywords' && <KeywordScreen notify={notify} />}
            {screen === 'accounts' && <AccountsScreen notify={notify} onProfile={setAccountModal} />}
          </div>
        </main>
      </div>
      <MobileNav screen={screen} onChange={changeScreen} />
      <div className={`pointer-events-none fixed bottom-[22px] right-[22px] z-[100] rounded-[14px] bg-[#2D4F79] px-[17px] py-[13px] text-[11px] font-black text-white shadow-panel transition duration-[230ms] max-[820px]:bottom-[calc(84px+max(14px,env(safe-area-inset-bottom)))] max-[820px]:left-3.5 max-[820px]:right-3.5 max-[820px]:text-center ${toast ? 'translate-y-0 opacity-100' : 'translate-y-[160%] opacity-0'}`}>{toast || '更新しました。'}</div>
      <AccountModal account={accountModal} onClose={() => setAccountModal(null)} />
    </div>
  )
}
