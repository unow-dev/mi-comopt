import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './components/Icon.jsx'
import { copyToClipboard } from './clipboard.js'
import { filterComments, isNewCandidate, LABELS, labelName, paginate, RECOMMENDATIONS } from './data-model.js'
import {
  emptyActionState,
  markAccountCopied,
  markKeywordCopied,
  readActionState,
  saveActionState,
  toggleAccountBlocked,
} from './local-state.js'
import { loadReleaseSession } from './release-client.js'

const screens = [
  ['home', 'ホーム', 'home'],
  ['overview', '分析概要', 'dashboard'],
  ['comments', 'コメント一覧', 'comment'],
  ['keywords', 'フィルターキーワード候補', 'filter'],
  ['accounts', 'ブロックアカウント候補', 'block'],
]
const screenTitles = Object.fromEntries(screens.map(([id, label]) => [id, label]))
const card = 'rounded-[20px] border border-line bg-white/95 shadow-soft'
const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 text-[11px] font-black transition hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-45'

function Pill({ children, tone = 'blue' }) {
  const styles = {
    blue: 'bg-[#EAF8FF] text-[#228FC9]',
    green: 'bg-[#EEFBF6] text-[#2E9D78]',
    yellow: 'bg-[#FFF8E5] text-[#A77808]',
    pink: 'bg-[#FFF0F5] text-[#D94A79]',
  }
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1.5 text-[9px] font-black ${styles[tone]}`}>{children}</span>
}

function Brand({ compact = false }) {
  return <div className={`flex items-center ${compact ? 'gap-2' : 'gap-3'}`} aria-label="Optimicom">
    <div className={`grid place-items-center rounded-xl bg-[linear-gradient(145deg,#4EC8F7,#2BB1EA_55%,#FF5F98)] font-black text-white shadow-[0_8px_18px_rgba(46,173,229,.22)] ${compact ? 'h-8 w-8 text-xs' : 'h-11 w-11 text-base'}`}>O+</div>
    <div className="whitespace-nowrap text-[17px] font-black tracking-[-.045em] text-ink">Optimi<span className="text-pink">com</span>{!compact && <small className="mt-1 block text-[9px] font-bold tracking-[.08em] text-[#7A91AE]">コメントケアコンソール</small>}</div>
  </div>
}

function Sidebar({ screen, onChange }) {
  return <aside className="sticky top-0 z-30 flex h-screen w-[252px] shrink-0 flex-col gap-6 border-r border-line bg-white/85 px-4 pb-[18px] pt-[22px] backdrop-blur-[20px] max-[820px]:hidden">
    <Brand />
    <nav className="grid gap-1.5" aria-label="メインナビゲーション">
      {screens.map(([id, label, icon]) => <button key={id} type="button" onClick={() => onChange(id)} className={`flex w-full items-center gap-[11px] rounded-[14px] border-0 p-3 text-left font-black transition ${screen === id ? 'bg-gradient-to-r from-[#E8F9FF] to-[#F7FDFF] text-[#1E9DDD] shadow-[inset_0_0_0_1px_#CDEBF8]' : 'bg-transparent text-[#617593] hover:bg-[#F0FAFF] hover:text-[#239DDA]'}`}>
        <span className={`grid h-[34px] w-[34px] shrink-0 place-items-center rounded-xl ${screen === id ? 'bg-gradient-to-br from-sky to-[#2EB0E9] text-white' : 'bg-[#F2F7FB] text-[#7B90AA]'}`}><Icon name={icon} /></span>
        <span className="min-w-0">{label}<small className="mt-0.5 block text-[9px] font-bold text-[#A3B0C1]">{id === 'home' ? 'サービス概要' : id === 'overview' ? '分類と推移' : id === 'comments' ? '対象観測' : id === 'keywords' ? '推奨度確認' : '候補判定'}</small></span>
      </button>)}
    </nav>
    <div className="mt-auto border-t border-line px-2.5 pb-1 pt-3.5 text-[10px] leading-[1.7] text-[#98A7BA]">Comment DBを正本とする<br />read-only公開データ</div>
  </aside>
}

function Header({ screen, onChange, dataEndDate }) {
  return <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between gap-4 border-b border-[rgba(220,234,244,.92)] bg-[rgba(250,253,255,.92)] px-7 backdrop-blur-[18px] max-[820px]:h-16 max-[820px]:px-3.5">
    <div className="flex min-w-0 items-center gap-2.5">
      {screen !== 'home' && <button type="button" onClick={() => onChange('home')} aria-label="ホームへ戻る" className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-xl border border-line bg-white text-[#5A7594]"><Icon name="back" strokeWidth={2} /></button>}
      <div className="min-w-0"><strong className="block truncate text-lg font-black leading-[1.1] tracking-[-.025em] max-[820px]:text-base">{screenTitles[screen]}</strong><span className="mt-1 block text-[10px] text-[#8A9AB0] max-[820px]:hidden">Comment DB公開データ</span></div>
    </div>
    <div className="flex items-center gap-2"><span className="whitespace-nowrap rounded-full border border-[#D7E8F4] bg-white px-3 py-2 text-[10px] font-black text-[#587392] max-[560px]:max-w-[140px] max-[560px]:overflow-hidden max-[560px]:text-ellipsis">データ基準日: {dataEndDate || '—'}</span></div>
  </header>
}

function SectionHeader({ title, description, right }) {
  return <div className="mb-5 flex items-end justify-between gap-[18px] max-[820px]:mb-4 max-[820px]:flex-col max-[820px]:items-start"><div><h1 className="mb-[7px] mt-0 text-[32px] font-black leading-[1.15] tracking-[-.05em] max-[820px]:text-[27px]">{title}</h1><p className="m-0 text-xs text-muted max-[560px]:text-[11px]">{description}</p></div>{right}</div>
}

function HomeScreen({ onChange }) {
  return <section className="animate-screen"><article className="relative overflow-hidden rounded-[28px] border border-[#D9EAF5] bg-[linear-gradient(145deg,#FFFFFF,#F4FCFF_58%,#FFF4F8)] p-[34px] shadow-panel max-[560px]:p-[24px_18px]"><Pill>COMMENT OPTIMIZATION PLATFORM</Pill><h1 className="relative my-4 max-w-[760px] text-[clamp(38px,5vw,64px)] font-black leading-[1.02] tracking-[-.065em] max-[560px]:text-[40px]">コメント欄を、<br /><span className="text-pink">もっと健やかに。</span></h1><p className="relative m-0 max-w-[720px] text-sm leading-[1.8] text-[#657B99]">Optimicomは、通常・二次反応・一次迷惑の3分類によるコメント分析と、フィルター候補・アカウント候補を確認するためのコンソールです。</p></article><div className="mt-4 grid grid-cols-4 gap-3 max-[820px]:grid-cols-2">{screens.slice(1).map(([id, label, icon]) => <button key={id} type="button" onClick={() => onChange(id)} className={`${card} flex items-center gap-3 p-4 text-left text-[11px] font-black text-[#55708F] transition hover:-translate-y-0.5 hover:border-[#8ED9F8]`}><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#EAF9FF] text-[#2298D3]"><Icon name={icon} /></span>{label}</button>)}</div></section>
}

function Percentage({ count, total }) {
  return <span className="text-[11px] font-black text-[#7B8EA7]">{total > 0 ? `${((count / total) * 100).toFixed(1)}%` : '—'}</span>
}

function OverviewScreen({ overview, onDataEndDate }) {
  const [periodKey, setPeriodKey] = useState('7d')
  useEffect(() => { onDataEndDate(overview.data_end_date) }, [onDataEndDate, overview.data_end_date])
  const period = overview.periods[periodKey]
  const maxDaily = Math.max(1, ...overview.daily.map((row) => row.observation_count ?? 0))
  return <section className="animate-screen"><SectionHeader title="分析概要" description={`基準日 ${overview.data_end_date} の3分類集計と日次推移です。`} right={<div className="flex gap-2">{[['1d', '1日'], ['7d', '7日'], ['30d', '30日']].map(([key, label]) => <button key={key} type="button" onClick={() => setPeriodKey(key)} className={`rounded-full border px-3 py-2 text-[10px] font-black ${periodKey === key ? 'border-[#8ED9F8] bg-[#EAF9FF] text-[#2298D3]' : 'border-line bg-white text-[#607592]'}`}>{label}</button>)}</div>} /><div className="mb-4 flex flex-wrap items-center gap-2"><span className="text-[11px] font-black text-[#587392]">対象観測数: {period.observation_count.toLocaleString('ja-JP')}</span>{period.coverage === 'partial' && <Pill tone="yellow">部分観測</Pill>}<span className="text-[10px] text-[#8A9AB0]">{period.start_date} — {period.end_date}</span></div><div className="grid grid-cols-3 gap-3 max-[820px]:grid-cols-1">{LABELS.map((item) => <article key={item.key} className={`${card} p-5`}><div className="flex items-center justify-between"><span className="text-[11px] font-black text-[#6B809D]">{item.label}</span><Pill tone={item.tone}>{item.key}</Pill></div><div className="mt-4 flex items-baseline gap-2"><strong className="text-4xl font-black text-[#234D7E]">{period.counts[item.key].toLocaleString('ja-JP')}</strong><Percentage count={period.counts[item.key]} total={period.observation_count} /></div></article>)}</div><div className="mt-4 grid grid-cols-[.8fr_1.2fr] gap-4 max-[980px]:grid-cols-1"><article className={`${card} p-5`}><h2 className="m-0 text-[15px] font-bold">分類構成</h2><p className="mt-1 text-[10px] text-muted">選択期間の対象観測数に占める割合</p><div className="mt-6 grid gap-3">{LABELS.map((item) => <div key={item.key}><div className="mb-1 flex justify-between text-[10px] font-black text-[#637896]"><span>{item.label}</span><span>{period.counts[item.key].toLocaleString('ja-JP')}件</span></div><div className="h-2 overflow-hidden rounded-full bg-[#ECF3F8]"><i className={`block h-full rounded-full ${item.key === 'normal' ? 'bg-[#8EE6C2]' : item.key === 'reactive' ? 'bg-[#FFD76A]' : 'bg-[#FF5F98]'}`} style={{ width: `${period.observation_count ? (period.counts[item.key] / period.observation_count) * 100 : 0}%` }} /></div></div>)}</div></article><article className={`${card} p-5`}><div className="flex items-start justify-between"><div><h2 className="m-0 text-[15px] font-bold">日次推移</h2><p className="mt-1 text-[10px] text-muted">欠測日は空白として表示</p></div><Pill>30日</Pill></div><div className="mt-5 flex h-[220px] items-end gap-1 overflow-hidden rounded-2xl border border-[#E7F0F6] bg-[#FBFEFF] px-2 pb-5 pt-4">{overview.daily.map((row) => <div key={row.date} className="group relative flex h-full flex-1 items-end" title={`${row.date}: ${row.observation_count === null ? '欠測' : `${row.observation_count}件`}`}><div className="flex w-full flex-col justify-end gap-px">{row.counts && <><i className="block w-full bg-[#FF5F98]" style={{ height: `${(row.counts.direct_nuisance / maxDaily) * 170}px` }} /><i className="block w-full bg-[#FFD76A]" style={{ height: `${(row.counts.reactive / maxDaily) * 170}px` }} /><i className="block w-full bg-[#8EE6C2]" style={{ height: `${(row.counts.normal / maxDaily) * 170}px` }} /></>}</div></div>)}</div><div className="mt-2 flex justify-between text-[9px] text-[#95A3B5]"><span>{overview.daily[0].date}</span><span>{overview.daily[29].date}</span></div></article></div></section>
}

function CommentsScreen({ artifact }) {
  const [label, setLabel] = useState('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const filtered = useMemo(() => filterComments(artifact.records, { label, query }), [artifact.records, label, query])
  const paged = useMemo(() => paginate(filtered, page), [filtered, page])
  useEffect(() => setPage(1), [label, query])
  return <section className="animate-screen"><SectionHeader title="コメント一覧" description="投稿日順（日単位）で対象観測を確認します。" right={<Pill>{artifact.records.length.toLocaleString('ja-JP')}件</Pill>} /><div className="mb-4 flex flex-wrap gap-2">{[['all', 'すべて'], ...LABELS.map(({ key, label: name }) => [key, name])].map(([key, name]) => <button key={key} type="button" onClick={() => setLabel(key)} className={`rounded-full border px-[13px] py-[9px] text-[10px] font-black ${label === key ? 'border-[#8ED9F8] bg-[#EAF9FF] text-[#2298D3]' : 'border-line bg-white text-[#637896]'}`}>{name}{key !== 'all' && ` ${artifact.records.filter((record) => record.label === key).length.toLocaleString('ja-JP')}`}</button>)}</div><div className="mb-3.5 flex items-center gap-[9px]"><input value={query} onChange={(event) => setQuery(event.target.value)} className="h-[42px] min-w-[260px] max-w-[520px] flex-1 rounded-[13px] border border-line bg-white px-[13px] text-ink outline-0 focus:border-[#72CCF4] max-[560px]:min-w-0 max-[560px]:text-base" placeholder="コメント・ユーザー名・ハンドルを検索" aria-label="コメントを検索" /><span className="text-[10px] font-black text-[#8392A7]">{filtered.length.toLocaleString('ja-JP')}件</span></div><div className="grid gap-2.5">{paged.records.map((record) => <article key={`${artifact.snapshot_ref.payload_sha256}-${record.source_index}`} className={`${card} grid grid-cols-[auto_1fr] items-start gap-[13px] p-4 max-[560px]:p-3.5`}><div className="grid h-[42px] w-[42px] place-items-center rounded-[14px] bg-[#ECF8FD] text-[#2A91C2]"><Icon name="user" /></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="text-xs">{record.username}</strong><span className="text-[10px] text-[#8A9AB0]">{record.handle}</span><Pill tone={LABELS.find((item) => item.key === record.label)?.tone}>{labelName(record.label)}</Pill></div><p className="mt-2 break-words text-xs leading-[1.7] text-[#536985]">{record.comment}</p><div className="mt-2 text-[10px] text-[#8A9AB0]">投稿日: {record.postedDate} / 取得値: {record.postedAt}</div></div></article>)}{paged.records.length === 0 && <div className={`${card} border-dashed p-10 text-center text-xs text-[#8A9AB0]`}>条件に一致する観測はありません。</div>}</div><div className="mt-4 flex items-center justify-center gap-3"><button type="button" disabled={paged.page <= 1} onClick={() => setPage((value) => value - 1)} className={`${button} border border-line bg-white text-[#607592]`}>前へ</button><span className="text-[10px] font-black text-[#7B8EA7]">{paged.page} / {paged.totalPages}</span><button type="button" disabled={paged.page >= paged.totalPages} onClick={() => setPage((value) => value + 1)} className={`${button} border border-line bg-white text-[#607592]`}>次へ</button></div></section>
}

function KeywordScreen({ artifact, release, actions, commitAction, notify }) {
  const [query, setQuery] = useState('')
  const [recommendation, setRecommendation] = useState('すべて')
  const [newOnly, setNewOnly] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set())
  const [now] = useState(() => new Date())
  const visible = useMemo(() => artifact.filter((item) => { const needle = query.trim().toLocaleLowerCase(); const text = `${item.keyword} ${item.variants.join(' ')} ${item.category}`.toLocaleLowerCase(); return (!needle || text.includes(needle)) && (recommendation === 'すべて' || item.recommendation === recommendation) && (!newOnly || isNewCandidate(item.introduced_at, now)) }), [artifact, newOnly, now, query, recommendation])
  const copy = async (item) => { if (await copyToClipboard(item.keyword)) { commitAction(markKeywordCopied(actions, item.candidate_id, new Date(), release.source.keyword_publication.run_id)); notify('コピー済みとして記録しました。') } else notify('コピーできませんでした。') }
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
  const copy = async (item) => { if (await copyToClipboard(item.handle)) { commitAction(markAccountCopied(actions, item.handle, new Date(), release.source.source_dataset_artifact_sha256)); notify('コピー済みとして記録しました。') } else notify('コピーできませんでした。') }
  const toggle = (item) => { commitAction(toggleAccountBlocked(actions, item.handle, new Date(), release.source.source_dataset_artifact_sha256)); notify(actions.accounts[item.handle]?.blocked_marked_at ? 'ブラウザ内のマークを解除しました。' : 'ブラウザ内にマークしました。') }
  return <section className="animate-screen"><SectionHeader title="ブロックアカウント候補" description="一次迷惑のbehavior eventが複数ある候補と、判定根拠例を確認します。" right={<Pill tone="pink">{artifact.length.toLocaleString('ja-JP')}候補</Pill>} /><div className="mb-3.5 flex items-center gap-[9px]"><input value={query} onChange={(event) => setQuery(event.target.value)} className="h-[42px] min-w-[220px] max-w-[420px] flex-1 rounded-[13px] border border-line bg-white px-[13px] outline-0 focus:border-[#72CCF4]" placeholder="ハンドルを検索" aria-label="ハンドルを検索" /></div><p className="mb-4 rounded-xl border border-[#D9EAF5] bg-[#F7FCFF] px-3 py-2.5 text-[10px] leading-[1.7] text-[#7085A0]">ブロック済みマークはこのブラウザ内の記録であり、TikTok上の状態を確認したものではありません。</p><div className="grid gap-3">{visible.map((item) => { const local = actions.accounts[item.handle]; const blocked = Boolean(local?.blocked_marked_at); const copied = Boolean(local?.copied_at); return <article key={item.handle} className={`${card} grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3.5 p-4 max-[560px]:grid-cols-1`}><div className="flex min-w-0 items-start gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#ECF8FD] text-[#2A91C2]"><Icon name="user" /></div><div className="min-w-0"><strong className="block truncate text-[13px]">{item.handle}</strong><span className="mt-1 block text-[10px] text-[#8090A6]">一次迷惑 {item.direct_nuisance_count}件 / 根拠例 {item.evidence_sample.length}件</span>{blocked && <Pill tone="yellow">ブラウザ内マーク済み</Pill>}</div></div><div className="flex flex-wrap justify-end gap-2 max-[560px]:col-span-full max-[560px]:justify-stretch"><button type="button" onClick={() => setAccount(item)} className={`${button} border border-line bg-white text-[#5D7390]`}>根拠を見る</button><button type="button" onClick={() => copy(item)} className={`${button} ${copied ? 'border border-[#D3DCE5] bg-[#F1F4F7] text-[#6F7E91]' : 'bg-gradient-to-b from-[#57CBF9] to-[#2AA9E5] text-white'}`}>{copied ? '✓ コピー済み' : '⧉ コピー'}</button><button type="button" onClick={() => toggle(item)} className={`${button} border ${blocked ? 'border-[#F3DB94] bg-[#FFF9E8] text-[#A77808]' : 'border-line bg-white text-[#5D7390]'}`}>{blocked ? 'マーク解除' : 'ブロック済みとしてマーク'}</button></div></article> })}{visible.length === 0 && <div className={`${card} border-dashed p-10 text-center text-xs text-[#8A9AB0]`}>該当するアカウント候補はありません。</div>}</div><AccountModal account={account} onClose={() => setAccount(null)} /></section>
}

function LoadingState({ label = 'データを読み込んでいます。' }) { return <div className={`${card} p-12 text-center text-xs text-[#8192AA]`} role="status">{label}</div> }
function ErrorState({ error, onRetry }) { return <div className={`${card} border-[#FFC7D7] bg-[#FFF9FB] p-10 text-center`} role="alert"><p className="m-0 text-xs font-black text-[#C44B72]">この画面の公開データを読み込めませんでした。</p><p className="mt-2 text-[10px] text-[#8A7180]">{error.message}</p><button type="button" onClick={onRetry} className={`${button} mt-4 bg-[#FFF0F5] text-[#C44B72]`}>再試行</button></div> }

function useArtifact(client, key, enabled) {
  const [state, setState] = useState({ status: 'idle', value: null, error: null })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => { if (!enabled) return undefined; let active = true; setState({ status: 'loading', value: null, error: null }); client.loadArtifact(key).then((value) => { if (active) setState({ status: 'ready', value, error: null }) }).catch((error) => { if (active) setState({ status: 'error', value: null, error }) }); return () => { active = false } }, [attempt, client, enabled, key])
  return { ...state, retry: () => setAttempt((value) => value + 1) }
}

export default function App() {
  const [screen, setScreen] = useState('home')
  const [session, setSession] = useState({ status: 'loading', client: null, error: null })
  const sessionPromise = useRef(null)
  const [actions, setActions] = useState(emptyActionState)
  const [persistence, setPersistence] = useState({ storage: null, enabled: false })
  const [toast, setToast] = useState('')
  const [dataEndDate, setDataEndDate] = useState('')
  const toastTimer = useRef(null)

  useEffect(() => { if (!sessionPromise.current) sessionPromise.current = loadReleaseSession(); sessionPromise.current.then((client) => setSession({ status: 'ready', client, error: null })).catch((error) => setSession({ status: 'error', client: null, error })) }, [])
  useEffect(() => { let storage = null; try { storage = window.localStorage } catch { /* persistence remains disabled */ } const loaded = readActionState(storage); setActions(loaded.state); setPersistence({ storage, enabled: loaded.enabled }); if (loaded.warning) { setToast(loaded.warning); toastTimer.current = window.setTimeout(() => setToast(''), 2600) } return () => window.clearTimeout(toastTimer.current) }, [])
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])
  const notify = (message) => { setToast(message); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(''), 1800) }
  const commitAction = (next) => { setActions(next); if (persistence.enabled && !saveActionState(persistence.storage, next)) { setPersistence((value) => ({ ...value, enabled: false })); notify('ローカル状態を保存できませんでした。データ表示は継続します。') } }
  const changeScreen = (next) => { setScreen(next); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const client = session.client
  const overviewState = useArtifact(client, 'overview', Boolean(client && screen === 'overview'))
  const commentsState = useArtifact(client, 'comments', Boolean(client && screen === 'comments'))
  const keywordsState = useArtifact(client, 'keywords', Boolean(client && screen === 'keywords'))
  const accountsState = useArtifact(client, 'accounts', Boolean(client && screen === 'accounts'))

  let content
  if (session.status === 'loading') content = <LoadingState label="公開データのrelease rootを読み込んでいます。" />
  else if (session.status === 'error') content = <div className={`${card} p-12 text-center`} role="alert"><p className="m-0 text-sm font-black text-[#C44B72]">公開データを利用できません。</p><p className="mt-2 text-xs text-[#8A7180]">release rootの検証に失敗しました。</p></div>
  else if (screen === 'home') content = <HomeScreen onChange={changeScreen} />
  else { const state = { overview: overviewState, comments: commentsState, keywords: keywordsState, accounts: accountsState }[screen]; content = state.status === 'loading' || state.status === 'idle' ? <LoadingState /> : state.status === 'error' ? <ErrorState error={state.error} onRetry={state.retry} /> : screen === 'overview' ? <OverviewScreen overview={state.value} onDataEndDate={setDataEndDate} /> : screen === 'comments' ? <CommentsScreen artifact={state.value} /> : screen === 'keywords' ? <KeywordScreen artifact={state.value} release={client.release} actions={actions} commitAction={commitAction} notify={notify} /> : <AccountsScreen artifact={state.value} release={client.release} actions={actions} commitAction={commitAction} notify={notify} /> }
  return <div className="min-h-screen text-sm leading-[1.55] text-ink"><div className="flex min-h-screen max-[820px]:block"><Sidebar screen={screen} onChange={changeScreen} /><main className="min-w-0 flex-1"><Header screen={screen} onChange={changeScreen} dataEndDate={dataEndDate} /><div className="p-7 max-[820px]:px-3.5 max-[820px]:pb-8 max-[820px]:pt-4">{content}</div></main></div><nav className="fixed bottom-[max(14px,env(safe-area-inset-bottom))] left-2.5 right-2.5 z-50 hidden rounded-[20px] border border-[#D8E8F3] bg-white/95 p-1.5 shadow-[0_16px_34px_rgba(44,83,122,.18)] max-[820px]:flex" aria-label="フッターナビゲーション">{screens.map(([id, label, icon]) => <button key={id} type="button" onClick={() => changeScreen(id)} className={`grid flex-1 place-items-center gap-0.5 rounded-[14px] border-0 px-0.5 py-[7px] text-[8px] font-black ${screen === id ? 'bg-[#EAF9FF] text-[#229ADD]' : 'bg-transparent text-[#73869F]'}`}><Icon name={icon} className="h-[19px] w-[19px]" />{label}</button>)}</nav><div className={`pointer-events-none fixed bottom-[22px] right-[22px] z-[100] rounded-[14px] bg-[#2D4F79] px-[17px] py-[13px] text-[11px] font-black text-white shadow-panel transition duration-[230ms] ${toast ? 'translate-y-0 opacity-100' : 'translate-y-[160%] opacity-0'}`}>{toast}</div></div>
}
