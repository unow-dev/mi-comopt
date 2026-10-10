import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './components/Icon.jsx'
import logoSrc from './images/logo.png'
import { copyToClipboard } from './clipboard.js'
import { filterComments, isNewCandidate, LABELS, labelName, paginate, RECOMMENDATIONS } from './data-model.js'
import {
  clearAccountCopied,
  clearKeywordCopied,
  emptyActionState,
  markAccountCopied,
  markKeywordCopied,
  readActionState,
  saveActionState,
  toggleAccountBlocked,
} from './local-state.js'
import { loadReleaseSession } from './release-client.js'
import { CAUTION_RATE, GOAL_RATE, WARNING_RATE, derivePublicOrderIndex, formatDirectNuisanceRate, formatPublicOrderScore } from './public-order-index.js'
import LoadingScreen from './loading/LoadingScreen.jsx'

const screens = [
  ['home', 'ホーム', 'home'],
  ['overview', '分析概要', 'dashboard'],
  ['comments', 'コメント一覧', 'comment'],
  ['keywords', 'フィルターキーワード候補', 'filter'],
  ['accounts', 'ブロックアカウント候補', 'block'],
]
const screenTitles = Object.fromEntries(screens.map(([id, label]) => [id, label]))
const INITIAL_LOADING_MINIMUM_MS = 2000
const ARTIFACT_LOADING_MINIMUM_MS = 700
const card = 'rounded-[20px] border border-line bg-white/95 shadow-soft'
const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 text-[11px] font-black transition hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-45'
const evaluationNames = {
  goal_met: '目標達成',
  goal_unmet: '目標未達',
  caution: '注意',
  warning: '警告',
  unavailable: '算出不可',
}
const evaluationTones = {
  goal_met: 'green',
  goal_unmet: 'blue',
  caution: 'yellow',
  warning: 'pink',
  unavailable: 'gray',
}

function statusComment(evaluation, rateLabel) {
  const comments = {
    goal_met: `一次迷惑率は ${rateLabel} で、目標範囲内です。現在は落ち着いた状態です。`,
    goal_unmet: `一次迷惑率は ${rateLabel} で、目標値を上回っています。分析概要で推移を確認してください。`,
    caution: `一次迷惑率は ${rateLabel} で、注意が必要な水準です。分析概要で内訳と推移を確認してください。`,
    warning: `一次迷惑率は ${rateLabel} で、警告水準です。対応候補もあわせて確認してください。`,
    unavailable: '対象観測がないため、治安指数を算出できません。',
  }
  return comments[evaluation]
}

function Pill({ children, tone = 'blue', className = '' }) {
  const styles = {
    blue: 'bg-[#EAF8FF] text-[#228FC9]',
    green: 'bg-[#EEFBF6] text-[#2E9D78]',
    yellow: 'bg-[#FFF8E5] text-[#A77808]',
    pink: 'bg-[#FFF0F5] text-[#D94A79]',
    gray: 'bg-[#F1F4F7] text-[#6F7E91]',
  }
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1.5 text-[9px] font-black ${styles[tone]} ${className}`}>{children}</span>
}

function PublicOrderGauge({ rate, className = '' }) {
  const maxRate = 6
  const ticks = [0, GOAL_RATE, CAUTION_RATE, WARNING_RATE, maxRate]
  const segmentStyles = ['rounded-l-full bg-[#8EE6C2]', 'bg-[#6FC8F2]', 'bg-[#FFD76A]', 'rounded-r-full bg-[#FF8EAE]']
  const markerPosition = rate === null ? null : Math.min(rate / maxRate, 1) * 100

  return <div className={`px-1 ${className}`} aria-hidden="true">
    <div className="relative h-2.5 rounded-full bg-[#ECF3F8]">
      {segmentStyles.map((style, index) => <div key={style} className={`absolute inset-y-0 ${style}`} style={{ left: `${(ticks[index] / maxRate) * 100}%`, width: `${((ticks[index + 1] - ticks[index]) / maxRate) * 100}%` }} />)}
      {markerPosition !== null && <span className="absolute -top-[3px] h-4 w-[3px] rounded-full bg-[#234D7E] ring-2 ring-white" style={{ left: `calc(${markerPosition}% - 1.5px)` }} />}
    </div>
    <div className="relative mt-1 h-4 text-[9px] font-bold text-[#8A9AB0]">
      {ticks.map((value, index) => <span key={value} className="absolute" style={{ left: `${(value / maxRate) * 100}%`, transform: index === 0 ? 'none' : index === ticks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)' }}>{value}%</span>)}
    </div>
  </div>
}

function Brand({ compact = false }) {
  return <div className={`flex items-center ${compact ? 'gap-2' : 'gap-3'}`} aria-label="こちらコメント管理局！">
    <img src={logoSrc} alt="こちらコメント管理局！" className={`block w-full object-contain object-center ${compact ? 'h-8' : 'h-[72px]'}`} />
  </div>
}

function Sidebar({ screen, onChange }) {
  return <aside className="sticky top-0 z-30 flex h-screen w-[252px] shrink-0 flex-col gap-6 border-r border-line bg-white/85 px-4 pb-[18px] pt-[22px] backdrop-blur-[20px] max-[820px]:hidden">
    <Brand />
    <nav className="grid gap-1.5" aria-label="メインナビゲーション">
      {screens.map(([id, label, icon]) => <button key={id} type="button" onClick={() => onChange(id)} className={`flex w-full items-center gap-[11px] rounded-[14px] border-0 p-3 text-left font-black transition ${screen === id ? 'bg-gradient-to-r from-[#E8F9FF] to-[#F7FDFF] text-[#1E9DDD] shadow-[inset_0_0_0_1px_#CDEBF8]' : 'bg-transparent text-[#617593] hover:bg-[#F0FAFF] hover:text-[#239DDA]'}`}>
        <span className={`grid h-[34px] w-[34px] shrink-0 place-items-center rounded-xl ${screen === id ? 'bg-gradient-to-br from-sky to-[#2EB0E9] text-white' : 'bg-[#F2F7FB] text-[#7B90AA]'}`}><Icon name={icon} /></span>
        <span className="min-w-0">{label}<small className="mt-0.5 block text-[9px] font-bold text-[#A3B0C1]">{id === 'home' ? '状態と対応候補' : id === 'overview' ? '分類と推移' : id === 'comments' ? '対象観測' : id === 'keywords' ? '推奨度確認' : '候補判定'}</small></span>
      </button>)}
    </nav>
    <div className="mt-auto border-t border-line px-2.5 pb-1 pt-3.5 text-[10px] leading-[1.7] text-[#98A7BA]">Comment DBを正本とする<br />read-only公開データ</div>
  </aside>
}

function Header({ screen, onChange, dataEndDate }) {
  const title = screen === 'home'
    ? <><span className="max-[820px]:hidden">ダッシュボード</span><span className="hidden items-center max-[820px]:inline-flex"><img src={logoSrc} alt="こちらコメント管理局！" className="block h-10 w-[162px] max-[360px]:w-[138px] object-contain object-center" /></span></>
    : screenTitles[screen]
  return <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between gap-4 border-b border-[rgba(220,234,244,.92)] bg-[rgba(250,253,255,.92)] px-7 backdrop-blur-[18px] max-[820px]:h-16 max-[820px]:px-3.5">
    <div className="flex min-w-0 items-center gap-2.5">
      {screen !== 'home' && <button type="button" onClick={() => onChange('home')} aria-label="ホームへ戻る" className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-xl border border-line bg-white text-[#5A7594]"><Icon name="back" strokeWidth={2} /></button>}
      <div className="min-w-0"><strong className="block truncate text-lg font-black leading-[1.1] tracking-[-.025em] max-[820px]:text-base">{title}</strong></div>
    </div>
    <div className="flex shrink-0 items-center gap-2"><span className="shrink-0 whitespace-nowrap rounded-full border border-[#D7E8F4] bg-white px-3 py-2 text-[10px] font-black text-[#587392] max-[560px]:px-2 max-[560px]:text-[9px]">データ基準日: {dataEndDate || '—'}</span></div>
  </header>
}

function SectionHeader({ title, right }) {
  return <div className="mb-5 flex items-end justify-between gap-[18px] max-[820px]:mb-4 max-[820px]:flex-col max-[820px]:items-start"><div><h1 className="mb-0 mt-0 text-[32px] font-black leading-[1.15] tracking-[-.05em] max-[820px]:text-[27px]">{title}</h1></div>{right}</div>
}

function DashboardScreen({ client, periodKey, onPeriodChange, onChange, onDataEndDate }) {
  const state = useArtifact(client, 'overview', { minimumLoadingMs: 0 })
  const overview = state.status === 'ready' ? state.value : null
  useEffect(() => {
    if (overview) onDataEndDate(overview.data_end_date)
  }, [onDataEndDate, overview])

  const period = overview?.periods[periodKey]
  const index = period ? derivePublicOrderIndex(period.counts.direct_nuisance, period.observation_count) : null
  const scoreLabel = index?.status === 'unavailable' ? '—' : index ? formatPublicOrderScore(index.score, index.evaluation) : null
  const rateLabel = index?.status === 'unavailable' ? '—' : index ? formatDirectNuisanceRate(index.directNuisanceRate, index.evaluation) : null
  const candidateCounts = client.release.artifacts

  return <section className="animate-screen">
    <SectionHeader title="コメント欄の状態" right={<PeriodSelector periodKey={periodKey} onPeriodChange={onPeriodChange} />} />

    {period && <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-[#DCEBF5] bg-white/70 px-3.5 py-3">
      <span className="text-[11px] font-black text-[#587392]">集計期間: {period.start_date} — {period.end_date}</span>
      {period.coverage === 'partial' && <><Pill tone="yellow">部分観測</Pill><span className="basis-full text-[10px] leading-[1.6] text-[#8A6C20]">一部の日付にデータがないため、取得できたデータのみで集計しています。</span></>}
    </div>}

    <div className="grid gap-4 min-[821px]:grid-cols-2" aria-busy={state.status === 'loading'}>
      {state.status === 'loading' && <>
        <article className={`${card} min-h-[228px] p-5`}><h2 className="m-0 text-[15px] font-bold">治安指数</h2><p className="mt-7 text-xs text-[#8292A8]">コメント欄の状態を読み込んでいます。</p></article>
        <article className={`${card} min-h-[228px] p-5`}><h2 className="m-0 text-[15px] font-bold">状態コメント</h2><div className="mt-7 h-10 animate-pulse rounded-xl bg-[#F0F5F8]" /></article>
      </>}

      {state.status === 'error' && <div className={`${card} border-[#FFC7D7] bg-[#FFF9FB] p-5 min-[821px]:col-span-2`} role="alert">
        <p className="m-0 text-xs font-black text-[#C44B72]">コメント欄の状態を読み込めませんでした。</p>
        <button type="button" onClick={state.retry} className={`${button} mt-4 min-h-11 bg-[#FFF0F5] text-[#C44B72]`}>再試行</button>
      </div>}

      {period && index && <>
        <article className={`${card} p-4 min-[821px]:p-5`} aria-labelledby="public-order-index-title">
          <div className="flex items-center justify-between gap-3"><h2 id="public-order-index-title" className="m-0 text-[15px] font-bold">治安指数</h2><Pill tone={evaluationTones[index.evaluation]}>{evaluationNames[index.evaluation]}</Pill></div>
          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-3">
            <div className="flex min-w-0 items-baseline gap-1"><strong className="min-w-0 truncate text-[clamp(42px,13vw,58px)] font-black leading-none tracking-[-.055em] text-[#234D7E]">{scoreLabel}</strong><span className="shrink-0 text-[12px] font-bold text-[#8A9AB0]">/ 100</span></div>
            <div className="pb-1 text-right"><span className="block text-[9px] font-bold text-[#8A9AB0]">一次迷惑率</span><strong className="whitespace-nowrap text-[15px] font-black text-[#536B8D]">{rateLabel}</strong></div>
          </div>
          <div className="mt-4 flex items-center justify-between rounded-xl bg-[#F7FBFE] px-3 py-2 text-[10px]"><span className="font-bold text-[#7488A2]">対象観測数</span><strong className="text-[#536B8D]">{period.observation_count.toLocaleString('ja-JP')}件</strong></div>
          <PublicOrderGauge rate={index.directNuisanceRate} className="mt-4" />
          <button type="button" onClick={() => onChange('overview')} className={`${button} mt-4 min-h-11 w-full justify-between border border-[#D7E8F4] bg-white text-[#34769D]`}><span>分析概要を見る</span><span aria-hidden="true">→</span></button>
        </article>

        <article className={`${card} flex min-h-[228px] flex-col p-5`}>
          <h2 className="m-0 text-[15px] font-bold">状態コメント</h2>
          <p className="mt-5 text-[13px] leading-[1.9] text-[#536985]">{statusComment(index.evaluation, rateLabel)}</p>
        </article>
      </>}
    </div>

    <section className="mt-5" aria-labelledby="response-candidates-title">
      <div className="mb-3"><h2 id="response-candidates-title" className="m-0 text-[18px] font-black tracking-[-.025em]">対応候補</h2><p className="mb-0 mt-1 text-[11px] text-[#7488A2]">AI分析から抽出された、確認対象の候補です。</p></div>
      <div className="grid gap-3 min-[821px]:grid-cols-2">
        {[["keywords", "フィルターキーワード候補", candidateCounts.keywords.record_count], ["accounts", "ブロックアカウント候補", candidateCounts.accounts.record_count]].map(([screen, label, count]) => <button key={screen} type="button" onClick={() => onChange(screen)} className={`${card} flex min-h-[58px] w-full items-center gap-3 p-4 text-left transition hover:-translate-y-0.5 hover:border-[#8ED9F8] focus-visible:outline-offset-2`}>
          <span className="min-w-0 flex-1 text-[12px] font-black text-[#55708F]">{label}</span><span className="shrink-0 text-[11px] font-black text-[#607592]">{count.toLocaleString('ja-JP')}件</span><span aria-hidden="true" className="shrink-0 text-lg leading-none text-[#69A7C5]">›</span>
        </button>)}
      </div>
    </section>
  </section>
}

function Percentage({ count, total }) {
  return <span className="text-[11px] font-black text-[#7B8EA7]">{total > 0 ? `${((count / total) * 100).toFixed(1)}%` : '—'}</span>
}

function PeriodSelector({ periodKey, onPeriodChange, includeOneDay = false }) {
  const options = includeOneDay ? [['1d', '1日'], ['7d', '7日'], ['30d', '30日']] : [['7d', '7日'], ['30d', '30日']]
  return <div className={`grid w-full gap-2 ${includeOneDay ? 'grid-cols-3' : 'grid-cols-2'} min-[821px]:w-auto`} role="group" aria-label="分析期間">
    {options.map(([key, label]) => <button key={key} type="button" aria-pressed={periodKey === key} onClick={() => onPeriodChange(key)} className={`min-h-11 rounded-[14px] border px-3 text-[11px] font-black ${periodKey === key ? 'border-[#8ED9F8] bg-[#EAF9FF] text-[#2298D3]' : 'border-line bg-white text-[#607592]'}`}>{label}</button>)}
  </div>
}

function OverviewScreen({ overview, periodKey, onPeriodChange, onDataEndDate }) {
  useEffect(() => { onDataEndDate(overview.data_end_date) }, [onDataEndDate, overview.data_end_date])
  const period = overview.periods[periodKey]
  const index = derivePublicOrderIndex(period.counts.direct_nuisance, period.observation_count)
  const maxDaily = Math.max(1, ...overview.daily.map((row) => row.observation_count ?? 0))

  const scoreLabel = index.status === 'unavailable' ? '—' : formatPublicOrderScore(index.score, index.evaluation)
  const rateLabel = index.status === 'unavailable' ? '—' : formatDirectNuisanceRate(index.directNuisanceRate, index.evaluation)

  return <section className="animate-screen">
    <SectionHeader title="コメント欄の状態" right={<PeriodSelector periodKey={periodKey} onPeriodChange={onPeriodChange} includeOneDay />} />

    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-[#DCEBF5] bg-white/70 px-3.5 py-3">
      <span className="text-[11px] font-black text-[#587392]">対象観測数: {period.observation_count.toLocaleString('ja-JP')}</span>
      {period.coverage === 'partial' && <Pill tone="yellow">部分観測</Pill>}
      <span className="text-[10px] text-[#8A9AB0]">{period.start_date} — {period.end_date}</span>
    </div>

    <article className={`${card} p-4 min-[821px]:p-5`} aria-labelledby="public-order-index-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="public-order-index-title" className="m-0 text-[15px] font-bold">治安指数</h2>
        <Pill tone={evaluationTones[index.evaluation]}>{evaluationNames[index.evaluation]}</Pill>
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-3">
        <div className="flex min-w-0 items-baseline gap-1">
          <strong className="min-w-0 truncate text-[clamp(42px,13vw,58px)] font-black leading-none tracking-[-.055em] text-[#234D7E]">{scoreLabel}</strong>
          <span className="shrink-0 text-[12px] font-bold text-[#8A9AB0]">/ 100</span>
        </div>
        <div className="pb-1 text-right">
          <span className="block text-[9px] font-bold text-[#8A9AB0]">一次迷惑率</span>
          <strong className="whitespace-nowrap text-[15px] font-black text-[#536B8D]">{rateLabel}</strong>
        </div>
      </div>
      <PublicOrderGauge rate={index.directNuisanceRate} className="mt-5" />
    </article>

    <div className="mt-4 grid grid-cols-[.8fr_1.2fr] gap-4 max-[980px]:grid-cols-1">
      <article className={`${card} p-4 min-[821px]:p-5`}>
        <h2 className="m-0 text-[15px] font-bold">分類内訳</h2>
        <p className="mt-1 text-[10px] text-muted">選択期間の対象観測数に占める割合</p>
        <div className="mt-5 grid gap-4">
          {LABELS.map((item) => {
            const count = period.counts[item.key]
            const percentage = period.observation_count ? (count / period.observation_count) * 100 : null
            const color = item.key === 'normal' ? 'bg-[#8EE6C2]' : item.key === 'reactive' ? 'bg-[#FFD76A]' : 'bg-[#FF5F98]'
            return <div key={item.key}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-[10px] font-black text-[#637896]">
                <span>{item.label}</span>
                <span className="whitespace-nowrap">{count.toLocaleString('ja-JP')}件 <span className="ml-1 text-[#8A9AB0]">{percentage === null ? '—' : `${percentage.toFixed(1)}%`}</span></span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[#ECF3F8]"><i className={`block h-full rounded-full ${color}`} style={{ width: `${percentage ?? 0}%` }} /></div>
            </div>
          })}
        </div>
      </article>

      <article className={`${card} p-4 min-[821px]:p-5`}>
        <div className="flex items-start justify-between gap-3"><div><h2 className="m-0 text-[15px] font-bold">日次推移</h2><p className="mt-1 text-[10px] text-muted">期間選択と独立した30日系列（欠測日は空白）</p></div><Pill className="whitespace-nowrap">30日</Pill></div>
        <div className="mt-4 flex h-[178px] items-end gap-px overflow-hidden rounded-2xl border border-[#E7F0F6] bg-[#FBFEFF] px-2 pb-5 pt-4 min-[821px]:h-[220px] min-[821px]:gap-1">
          {overview.daily.map((row) => <div key={row.date} className="group relative flex h-full min-w-0 flex-1 items-end" title={`${row.date}: ${row.observation_count === null ? '欠測' : `${row.observation_count}件`}`}><div className="flex w-full min-w-0 flex-col justify-end gap-px">{row.counts && <><i className="block w-full max-[820px]:max-h-[136px] bg-[#FF5F98]" style={{ height: `${(row.counts.direct_nuisance / maxDaily) * 170}px` }} /><i className="block w-full max-[820px]:max-h-[136px] bg-[#FFD76A]" style={{ height: `${(row.counts.reactive / maxDaily) * 170}px` }} /><i className="block w-full max-[820px]:max-h-[136px] bg-[#8EE6C2]" style={{ height: `${(row.counts.normal / maxDaily) * 170}px` }} /></>}</div></div>)}
        </div>
        <div className="mt-2 flex justify-between text-[9px] text-[#95A3B5]"><span>{overview.daily[0].date}</span><span>{overview.daily[29].date}</span></div>
      </article>
    </div>
  </section>
}

function CommentsScreen({ artifact }) {
  const [label, setLabel] = useState('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const filtered = useMemo(() => filterComments(artifact.records, { label, query }), [artifact.records, label, query])
  const paged = useMemo(() => paginate(filtered, page), [filtered, page])
  useEffect(() => setPage(1), [label, query])
  const identity = artifact.schema_version === 2 ? artifact.source.corpus_version_id : artifact.snapshot_ref.payload_sha256
  return <section className="animate-screen"><SectionHeader title="コメント一覧" description="投稿日順（日単位）で対象観測を確認します。" right={<Pill>{artifact.records.length.toLocaleString('ja-JP')}件</Pill>} /><div className="mb-4 flex flex-wrap gap-2">{[['all', 'すべて'], ...LABELS.map(({ key, label: name }) => [key, name])].map(([key, name]) => <button key={key} type="button" onClick={() => setLabel(key)} className={`rounded-full border px-[13px] py-[9px] text-[10px] font-black ${label === key ? 'border-[#8ED9F8] bg-[#EAF9FF] text-[#2298D3]' : 'border-line bg-white text-[#637896]'}`}>{name}{key !== 'all' && ` ${artifact.records.filter((record) => record.label === key).length.toLocaleString('ja-JP')}`}</button>)}</div><div className="mb-3.5 flex items-center gap-[9px]"><input value={query} onChange={(event) => setQuery(event.target.value)} className="h-[42px] min-w-[260px] max-w-[520px] flex-1 rounded-[13px] border border-line bg-white px-[13px] text-ink outline-0 focus:border-[#72CCF4] max-[560px]:min-w-0 max-[560px]:text-base" placeholder="コメント・ユーザー名・ハンドルを検索" aria-label="コメントを検索" /><span className="text-[10px] font-black text-[#8392A7]">{filtered.length.toLocaleString('ja-JP')}件</span></div><div className="grid gap-2.5">{paged.records.map((record) => <article key={`${identity}-${record.source_index}`} className={`${card} grid grid-cols-[auto_1fr] items-start gap-[13px] p-4 max-[560px]:p-3.5`}><div className="grid h-[42px] w-[42px] place-items-center rounded-[14px] bg-[#ECF8FD] text-[#2A91C2]"><Icon name="user" /></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="text-xs">{record.username}</strong><span className="min-w-0 max-w-full break-words text-[10px] text-[#8A9AB0]">{record.handle}</span><Pill tone={LABELS.find((item) => item.key === record.label)?.tone}>{labelName(record.label)}</Pill></div><p className="mt-2 break-words text-xs leading-[1.7] text-[#536985]">{record.comment}</p><div className="mt-2 text-[10px] text-[#8A9AB0]">投稿日: {record.postedDate} / 取得値: {record.postedAt}</div></div></article>)}{paged.records.length === 0 && <div className={`${card} border-dashed p-10 text-center text-xs text-[#8A9AB0]`}>条件に一致する観測はありません。</div>}</div><div className="mt-4 flex items-center justify-center gap-3"><button type="button" disabled={paged.page <= 1} onClick={() => setPage((value) => value - 1)} className={`${button} border border-line bg-white text-[#607592]`}>前へ</button><span className="text-[10px] font-black text-[#7B8EA7]">{paged.page} / {paged.totalPages}</span><button type="button" disabled={paged.page >= paged.totalPages} onClick={() => setPage((value) => value + 1)} className={`${button} border border-line bg-white text-[#607592]`}>次へ</button></div></section>
}

function KeywordScreen({ artifact, release, actions, commitAction, notify }) {
  const [query, setQuery] = useState('')
  const [recommendation, setRecommendation] = useState('すべて')
  const [newOnly, setNewOnly] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set())
  const [now] = useState(() => new Date())
  const visible = useMemo(() => artifact.filter((item) => { const needle = query.trim().toLocaleLowerCase(); const text = `${item.keyword} ${item.variants.join(' ')} ${item.category}`.toLocaleLowerCase(); return (!needle || text.includes(needle)) && (recommendation === 'すべて' || item.recommendation === recommendation) && (!newOnly || isNewCandidate(item.introduced_at, now)) }), [artifact, newOnly, now, query, recommendation])
  const copy = async (item) => { if (actions.keywords[item.candidate_id]?.copied_at) { commitAction(clearKeywordCopied(actions, item.candidate_id)); notify('コピー済みを解除しました。'); return } if (await copyToClipboard(item.keyword)) { commitAction(markKeywordCopied(actions, item.candidate_id, new Date(), release.source.keyword_publication.run_id)); notify('コピーしました。') } else notify('コピーできませんでした。') }
  return <section className="animate-screen"><SectionHeader title="フィルターキーワード候補" description="DB-current publicationの候補順と構造化された判定根拠を表示します。" right={<Pill tone="yellow">{artifact.length.toLocaleString('ja-JP')}候補</Pill>} /><div className="mb-3.5 flex flex-wrap items-center gap-[9px]"><input value={query} onChange={(event) => setQuery(event.target.value)} className="h-[42px] min-w-[220px] max-w-[420px] flex-1 rounded-[13px] border border-line bg-white px-[13px] outline-0 focus:border-[#72CCF4] max-[560px]:min-w-full" placeholder="キーワード・variant・カテゴリを検索" aria-label="キーワードを検索" /><select value={recommendation} onChange={(event) => setRecommendation(event.target.value)} className="h-[42px] rounded-[13px] border border-line bg-white px-3 text-[11px] text-[#586E8D]" aria-label="推奨度"><option>すべて</option>{RECOMMENDATIONS.map((value) => <option key={value}>{value}</option>)}</select><label className="inline-flex h-[42px] items-center gap-[7px] rounded-[13px] border border-line bg-white px-3 text-[10px] font-black text-[#586E8D]"><input type="checkbox" checked={newOnly} onChange={(event) => setNewOnly(event.target.checked)} className="h-4 w-4 accent-[#229CDE]" />NEWのみ</label></div><div className="grid gap-3">{visible.map((item) => { const copied = Boolean(actions.keywords[item.candidate_id]?.copied_at); const isExpanded = expanded.has(item.candidate_id); return <article key={item.candidate_id} className={`${card} grid grid-cols-[minmax(0,1fr)_auto] gap-3.5 p-4 max-[560px]:grid-cols-1`}><div><div className="flex flex-wrap items-center gap-2"><code className="rounded-lg border border-[#E1EBF3] bg-[#F0F6FA] px-1.5 py-[3px] text-[11px] text-[#385777]">{item.keyword}</code><Pill tone={item.recommendation === '高推奨' ? 'pink' : item.recommendation === '中推奨' ? 'yellow' : 'blue'}>{item.recommendation}</Pill>{isNewCandidate(item.introduced_at, now) && <Pill>NEW</Pill>}</div><div className="mt-2 flex flex-wrap gap-3 text-[10px] text-[#8392A7]"><span>{item.category}</span><span>D {item.direct_nuisance_hits}</span><span>R {item.reactive_hits}</span><span>N {item.normal_hits}</span><span>precision {item.precision_excluding_reactive === null ? '—' : `${(item.precision_excluding_reactive * 100).toFixed(1)}%`}</span></div><button type="button" aria-expanded={isExpanded} onClick={() => setExpanded((previous) => { const next = new Set(previous); isExpanded ? next.delete(item.candidate_id) : next.add(item.candidate_id); return next })} className="mt-2.5 border-0 bg-transparent px-0 py-1 text-[10px] font-black text-[#4E6C8D]">判定根拠 {isExpanded ? '閉じる' : '表示'}</button>{isExpanded && <div className="mt-1.5 rounded-xl border border-[#E7EFF5] bg-[#F8FBFE] px-3 py-[11px] text-[10px] leading-[1.8] text-[#5D7390]"><b className="block text-[#385777]">カテゴリ: {item.category}</b><span>D hit: {item.direct_nuisance_hits} / R hit: {item.reactive_hits} / N hit: {item.normal_hits}</span><br /><span>precision excluding reactive: {item.precision_excluding_reactive === null ? '—' : `${(item.precision_excluding_reactive * 100).toFixed(1)}%`}</span><br /><span>variants: {item.variants.join(' / ')}</span></div>}</div><button type="button" onClick={() => copy(item)} className={`${button} min-w-[100px] self-start ${copied ? 'border border-[#D3DCE5] bg-[#F1F4F7] text-[#6F7E91]' : 'bg-gradient-to-b from-[#57CBF9] to-[#2AA9E5] text-white shadow-[0_8px_18px_rgba(42,169,229,.18)]'}`}>{copied ? '✓ コピー済み' : '⧉ コピー'}</button></article> })}{visible.length === 0 && <div className={`${card} border-dashed p-10 text-center text-xs text-[#8A9AB0]`}>条件に一致する候補はありません。</div>}</div></section>
}

function AccountModal({ account, onClose }) {
  useEffect(() => { if (!account) return undefined; const close = (event) => { if (event.key === 'Escape') onClose() }; document.addEventListener('keydown', close); document.body.style.overflow = 'hidden'; return () => { document.removeEventListener('keydown', close); document.body.style.overflow = '' } }, [account, onClose])
  if (!account) return null
  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[rgba(24,49,83,.34)] p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section role="dialog" aria-modal="true" aria-labelledby="account-dialog-title" className="max-h-[80vh] w-[min(620px,calc(100vw-32px))] overflow-auto rounded-3xl border border-[#CFE4F2] bg-white p-5 shadow-[0_30px_80px_rgba(32,64,101,.24)]"><div className="flex items-center justify-between gap-3"><div><h2 id="account-dialog-title" className="m-0 text-lg font-bold">{account.handle}</h2><p className="mt-1 text-[10px] text-[#8A9AB0]">候補判定の根拠</p></div><button type="button" onClick={onClose} aria-label="閉じる" className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-white text-xl text-[#72859E]">×</button></div><div className="mt-4 grid gap-2">{account.evidence_sample.map((evidence, index) => <article key={`${account.handle}-${index}`} className="rounded-[15px] border border-[#E2EDF5] bg-[#FBFDFF] p-3"><p className="m-0 text-[11px] leading-[1.7] text-[#4F6583]">{evidence.comment}</p><small className="mt-2 block text-[9px] font-black text-[#99A7B8]">投稿日: {evidence.postedDate} / 取得値: {evidence.postedAt}</small></article>)}</div><p className="mt-4 text-[10px] leading-[1.7] text-[#8192AA]">表示しているのは候補判定に使った根拠例であり、完全な投稿履歴ではありません。</p></section></div>
}

function AccountsScreen({ artifact, release, actions, commitAction, notify }) {
  const [query, setQuery] = useState('')
  const [account, setAccount] = useState(null)
  const visible = artifact.filter((item) => !query.trim() || item.handle.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const copy = async (item) => { if (actions.accounts[item.handle]?.copied_at) { commitAction(clearAccountCopied(actions, item.handle)); notify('コピー済みを解除しました。'); return } if (await copyToClipboard(item.handle)) { commitAction(markAccountCopied(actions, item.handle, new Date(), release.source.source_dataset_artifact_sha256)); notify('コピーしました。') } else notify('コピーできませんでした。') }
  const toggle = (item) => { commitAction(toggleAccountBlocked(actions, item.handle, new Date(), release.source.source_dataset_artifact_sha256)); notify(actions.accounts[item.handle]?.blocked_marked_at ? 'ブラウザ内のマークを解除しました。' : 'ブラウザ内にマークしました。') }
  return <section className="animate-screen"><SectionHeader title="ブロックアカウント候補" description="一次迷惑のbehavior eventが複数ある候補と、判定根拠例を確認します。" right={<Pill tone="pink">{artifact.length.toLocaleString('ja-JP')}候補</Pill>} /><div className="mb-3.5 flex items-center gap-[9px]"><input value={query} onChange={(event) => setQuery(event.target.value)} className="h-[42px] min-w-[220px] max-w-[420px] flex-1 rounded-[13px] border border-line bg-white px-[13px] outline-0 focus:border-[#72CCF4]" placeholder="ハンドルを検索" aria-label="ハンドルを検索" /></div><p className="mb-4 rounded-xl border border-[#D9EAF5] bg-[#F7FCFF] px-3 py-2.5 text-[10px] leading-[1.7] text-[#7085A0]">ブロック済みマークはこのブラウザ内の記録であり、TikTok上の状態を確認したものではありません。</p><div className="grid gap-3">{visible.map((item) => { const local = actions.accounts[item.handle]; const blocked = Boolean(local?.blocked_marked_at); const copied = Boolean(local?.copied_at); return <article key={item.handle} className={`${card} grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3.5 p-4 max-[560px]:grid-cols-1`}><div className="flex min-w-0 items-start gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#ECF8FD] text-[#2A91C2]"><Icon name="user" /></div><div className="min-w-0"><strong className="block truncate text-[13px]">{item.handle}</strong><span className="mt-1 block text-[10px] text-[#8090A6]">一次迷惑 {item.direct_nuisance_count}件 / 根拠例 {item.evidence_sample.length}件</span>{blocked && <Pill tone="yellow">ブラウザ内マーク済み</Pill>}</div></div><div className="flex flex-wrap justify-end gap-2 max-[560px]:col-span-full max-[560px]:justify-stretch"><button type="button" onClick={() => setAccount(item)} className={`${button} border border-line bg-white text-[#5D7390]`}>根拠を見る</button><button type="button" onClick={() => copy(item)} className={`${button} ${copied ? 'border border-[#D3DCE5] bg-[#F1F4F7] text-[#6F7E91]' : 'bg-gradient-to-b from-[#57CBF9] to-[#2AA9E5] text-white'}`}>{copied ? '✓ コピー済み' : '⧉ コピー'}</button><button type="button" onClick={() => toggle(item)} className={`${button} border ${blocked ? 'border-[#F3DB94] bg-[#FFF9E8] text-[#A77808]' : 'border-line bg-white text-[#5D7390]'}`}>{blocked ? 'マーク解除' : 'ブロック済みとしてマーク'}</button></div></article> })}{visible.length === 0 && <div className={`${card} border-dashed p-10 text-center text-xs text-[#8A9AB0]`}>該当するアカウント候補はありません。</div>}</div><AccountModal account={account} onClose={() => setAccount(null)} /></section>
}

function ErrorState({ error, onRetry }) { return <div className={`${card} border-[#FFC7D7] bg-[#FFF9FB] p-10 text-center`} role="alert"><p className="m-0 text-xs font-black text-[#C44B72]">この画面の公開データを読み込めませんでした。</p><p className="mt-2 text-[10px] text-[#8A7180]">{error.message}</p><button type="button" onClick={onRetry} className={`${button} mt-4 bg-[#FFF0F5] text-[#C44B72]`}>再試行</button></div> }

function useArtifact(client, key, { minimumLoadingMs = ARTIFACT_LOADING_MINIMUM_MS } = {}) {
  const [state, setState] = useState(() => {
    const value = client.getCachedArtifact(key)
    return value === null ? { status: 'loading', value: null, error: null } : { status: 'ready', value, error: null }
  })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    let timer = null
    const cached = client.getCachedArtifact(key)
    if (cached !== null) {
      setState((current) => current.status === 'ready' && current.value === cached ? current : { status: 'ready', value: cached, error: null })
      return () => { active = false }
    }
    const startedAt = Date.now()
    const finishLoading = (nextState) => {
      if (!active) return
      const remaining = Math.max(0, minimumLoadingMs - (Date.now() - startedAt))
      if (remaining === 0) {
        setState(nextState)
        return
      }
      timer = window.setTimeout(() => {
        if (active) setState(nextState)
      }, remaining)
    }
    client.loadArtifact(key).then((value) => {
      finishLoading({ status: 'ready', value, error: null })
    }).catch((error) => {
      finishLoading({ status: 'error', value: null, error })
    })
    return () => { active = false; window.clearTimeout(timer) }
  }, [attempt, client, key, minimumLoadingMs])
  const retry = () => {
    setState({ status: 'loading', value: null, error: null })
    setAttempt((value) => value + 1)
  }
  return { ...state, retry }
}

function AppShell({ screen, onChange, dataEndDate, children }) {
  return <div className="min-h-screen text-sm leading-[1.55] text-ink"><div className="flex min-h-screen max-[820px]:block"><Sidebar screen={screen} onChange={onChange} /><main className="min-w-0 flex-1"><Header screen={screen} onChange={onChange} dataEndDate={dataEndDate} /><div className="p-7 max-[820px]:px-3.5 max-[820px]:pb-28 max-[820px]:pt-4">{children}</div></main></div><nav className="fixed bottom-[max(14px,env(safe-area-inset-bottom))] left-2.5 right-2.5 z-50 hidden rounded-[20px] border border-[#D8E8F3] bg-white/95 p-1.5 shadow-[0_16px_34px_rgba(44,83,122,.18)] max-[820px]:flex" aria-label="フッターナビゲーション">{screens.map(([id, label, icon]) => <button key={id} type="button" aria-current={screen === id ? 'page' : undefined} onClick={() => onChange(id)} className={`grid flex-1 place-items-center gap-0.5 rounded-[14px] border-0 px-0.5 py-[7px] text-[8px] font-black ${screen === id ? 'bg-[#EAF9FF] text-[#229ADD]' : 'bg-transparent text-[#73869F]'}`}><Icon name={icon} className="h-[19px] w-[19px]" />{label}</button>)}</nav></div>
}

function ArtifactRoute({ screen, client, onChange, dataEndDate, onDataEndDate, periodKey, onPeriodChange, actions, commitAction, notify }) {
  const state = useArtifact(client, screen)
  if (state.status === 'loading') return <AppShell screen={screen} onChange={onChange} dataEndDate={dataEndDate}><LoadingScreen mode="content" /></AppShell>
  if (state.status === 'error') {
    return <AppShell screen={screen} onChange={onChange} dataEndDate={dataEndDate}>
      <ErrorState error={state.error} onRetry={state.retry} />
    </AppShell>
  }

  const content = screen === 'overview'
    ? <OverviewScreen overview={state.value} periodKey={periodKey} onPeriodChange={onPeriodChange} onDataEndDate={onDataEndDate} />
    : screen === 'comments'
      ? <CommentsScreen artifact={state.value} />
      : screen === 'keywords'
        ? <KeywordScreen artifact={state.value} release={client.release} actions={actions} commitAction={commitAction} notify={notify} />
        : <AccountsScreen artifact={state.value} release={client.release} actions={actions} commitAction={commitAction} notify={notify} />

  return <AppShell screen={screen} onChange={onChange} dataEndDate={dataEndDate}>{content}</AppShell>
}

export default function App() {
  const [screen, setScreen] = useState('home')
  const [periodKey, setPeriodKey] = useState('7d')
  const [session, setSession] = useState({ status: 'loading', client: null, error: null })
  const [initialLoadingMinimumElapsed, setInitialLoadingMinimumElapsed] = useState(false)
  const sessionPromise = useRef(null)
  const [actions, setActions] = useState(emptyActionState)
  const [persistence, setPersistence] = useState({ storage: null, enabled: false })
  const [toast, setToast] = useState('')
  const [dataEndDate, setDataEndDate] = useState('')
  const toastTimer = useRef(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setInitialLoadingMinimumElapsed(true), INITIAL_LOADING_MINIMUM_MS)
    return () => window.clearTimeout(timer)
  }, [])
  useEffect(() => { if (!sessionPromise.current) sessionPromise.current = loadReleaseSession(); sessionPromise.current.then((client) => setSession({ status: 'ready', client, error: null })).catch((error) => setSession({ status: 'error', client: null, error })) }, [])
  useEffect(() => { let storage = null; try { storage = window.localStorage } catch { /* persistence remains disabled */ } const loaded = readActionState(storage); setActions(loaded.state); setPersistence({ storage, enabled: loaded.enabled }); if (loaded.warning) { setToast(loaded.warning); toastTimer.current = window.setTimeout(() => setToast(''), 2600) } return () => window.clearTimeout(toastTimer.current) }, [])
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])
  const notify = (message) => { setToast(message); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(''), 1800) }
  const commitAction = (next) => { setActions(next); if (persistence.enabled && !saveActionState(persistence.storage, next)) { setPersistence((value) => ({ ...value, enabled: false })); notify('ローカル状態を保存できませんでした。データ表示は継続します。') } }
  const changeScreen = (next) => { if (next === 'home') setPeriodKey((current) => current === '1d' ? '7d' : current); setScreen(next); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const rootError = <div className={`${card} p-12 text-center`} role="alert"><p className="m-0 text-sm font-black text-[#C44B72]">公開データを利用できません。</p><p className="mt-2 text-xs text-[#8A7180]">release rootの検証に失敗しました。</p></div>
  const view = session.status === 'loading' || !initialLoadingMinimumElapsed
    ? <LoadingScreen />
    : session.status === 'error'
      ? <AppShell screen={screen} onChange={changeScreen} dataEndDate={dataEndDate}>{rootError}</AppShell>
      : screen === 'home'
        ? <AppShell screen={screen} onChange={changeScreen} dataEndDate={dataEndDate}><DashboardScreen client={session.client} periodKey={periodKey} onPeriodChange={setPeriodKey} onChange={changeScreen} onDataEndDate={setDataEndDate} /></AppShell>
        : <ArtifactRoute key={screen} screen={screen} client={session.client} onChange={changeScreen} dataEndDate={dataEndDate} onDataEndDate={setDataEndDate} periodKey={periodKey} onPeriodChange={setPeriodKey} actions={actions} commitAction={commitAction} notify={notify} />

  return <>{view}<div className={`pointer-events-none fixed bottom-[22px] right-[22px] z-[100] rounded-[14px] bg-[#2D4F79] px-[17px] py-[13px] text-[11px] font-black text-white shadow-panel transition duration-[230ms] ${toast ? 'translate-y-0 opacity-100' : 'translate-y-[160%] opacity-0'}`}>{toast}</div></>
}
